"""Service Bus message dispatcher loop.

One pod processes one message at a time so KEDA scales accurately.
"""
from __future__ import annotations

import json
import os
import time
import traceback
import uuid
from typing import Any, Callable

from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusReceiveMode

from . import db
from .logging_setup import get_logger
from .metrics import JOB_DURATION, JOB_INFLIGHT, JOB_TOTAL

log = get_logger(__name__)

Handler = Callable[[uuid.UUID, dict[str, Any]], None]


def _client() -> ServiceBusClient:
    fqdn = os.environ["SERVICEBUS_FQDN"]  # e.g. ns.servicebus.windows.net
    cred = DefaultAzureCredential()
    return ServiceBusClient(fqdn, cred)


def run(job_type: str, queue: str, handler: Handler,
        max_messages: int | None = None) -> None:
    """Process messages until the queue is idle (then exit so KEDA can scale to 0)."""
    db.ensure_schema()
    idle_after = float(os.environ.get("IDLE_EXIT_SECONDS", "30"))
    processed = 0

    with _client() as sb, sb.get_queue_receiver(
        queue,
        receive_mode=ServiceBusReceiveMode.PEEK_LOCK,
        max_wait_time=int(idle_after),
    ) as receiver:
        log.info("worker started", extra={"queue": queue, "job_type": job_type})
        while True:
            msgs = receiver.receive_messages(max_message_count=1, max_wait_time=int(idle_after))
            if not msgs:
                log.info("queue idle, exiting", extra={"processed": processed})
                return
            msg = msgs[0]
            try:
                body = b"".join(msg.body) if hasattr(msg, "body") else bytes(msg)
                payload = json.loads(body.decode("utf-8"))
            except Exception:
                log.exception("bad message, dead-lettering")
                receiver.dead_letter_message(msg, reason="invalid-json")
                continue

            # Prefer job_id assigned by the API at enqueue time so the row created
            # in 'queued' state can be transitioned to 'running' here.
            try:
                job_id = uuid.UUID(str(payload.get("job_id"))) if payload.get("job_id") else uuid.uuid4()
            except Exception:
                job_id = uuid.uuid4()

            JOB_INFLIGHT.labels(job_type).inc()
            start = time.monotonic()
            db.insert_job(job_id, job_type, str(msg.message_id))
            try:
                handler(job_id, payload)
                receiver.complete_message(msg)
                db.finish_job(job_id, "succeeded")
                JOB_TOTAL.labels(job_type, "succeeded").inc()
                log.info("job done", extra={"job_id": str(job_id)})
            except Exception as exc:  # noqa: BLE001
                err = f"{exc}\n{traceback.format_exc()}"
                log.exception("job failed", extra={"job_id": str(job_id)})
                db.finish_job(job_id, "failed", error=err[:8000])
                JOB_TOTAL.labels(job_type, "failed").inc()
                # Let SB redeliver up to maxDeliveryCount, then DLQ.
                receiver.abandon_message(msg)
            finally:
                JOB_DURATION.labels(job_type).observe(time.monotonic() - start)
                JOB_INFLIGHT.labels(job_type).dec()
                processed += 1
                if max_messages is not None and processed >= max_messages:
                    return
