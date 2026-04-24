# Job pipeline

End-to-end trace of a forecast or RL submission.

## Forecast job

```
Browser → POST /api/jobs/forecast { device_id, horizon, num_samples }
                │
                ▼
        web /api proxy → API pod
                │
   ┌────────────┼─────────────────────────────────────────────────┐
   │  src/api/main.py:submit_forecast                             │
   │   1. db.recent_indoor_series(device_id, 256) → context list  │
   │   2. job_id = uuid4()                                        │
   │   3. payload = {job_id, dataset, context, horizon, ...}      │
   │   4. _send(forecast-jobs, payload) → SB message_id           │
   │   5. db.enqueue_job(job_id, "forecast", message_id)          │
   │   6. return {job_id, message_id}                             │
   └──────────────────────────────────────────────────────────────┘
                │ KEDA (queue depth ≥ 1)
                ▼
        forecast-worker pod scales 0 → 1 (cluster autoscaler may add a node)
                │
   ┌────────────┼──────────────────────────────────────────────┐
   │  src/forecast/worker.py via dispatcher.run                │
   │   1. receive_messages(PEEK_LOCK, lock=PT5M)               │
   │   2. db.insert_job(job_id, "forecast", mid) → "running"   │
   │   3. handle(): load Chronos-2, predict_quantiles, MAPE    │
   │   4. db.save_forecast(job_id, dataset, horizon, fc, mape) │
   │   5. complete_message + finish_job("succeeded")           │
   │   6. Idle for IDLE_EXIT_SECONDS → exit, KEDA scales to 0  │
   └───────────────────────────────────────────────────────────┘
                │
                ▼
        UI poll /api/jobs and /api/results/forecast updates
```

## RL job

Same flow, with worker `src/rl/worker.py` and queue `rl-jobs`.

```
1. POST /api/jobs/rl { algo, total_steps, learning_rate, seed? }
2. API enqueue_job + Service Bus send
3. KEDA scales rl-worker (maxReplicas=4 on time-sliced A100)
4. dispatcher.run("rl", ...) → handle:
     env = HvacRoomEnv(seed=seed)
     model = PPO(env, lr) or DQN(env, lr)
     model.learn(total_steps, callback=RewardCurve())
     mean_reward = evaluate(model, n=5)
     policy_uri = upload(blob://artifacts/rl/{job_id}/policy.zip)
     db.save_rl(job_id, algo, total_steps, mean_reward, reward_curve, policy_uri)
5. complete + finish_job("succeeded")
```

## Status lifecycle

```
queued     ← API enqueue_job (row inserted with status='queued', no started_at)
   │
   ▼
running    ← worker insert_job; sets started_at
   │
   ├─→ succeeded  ← finish_job; sets finished_at
   └─→ failed     ← finish_job(error); abandon_message → SB redelivery
                    (after max_delivery_count → DLQ)
```

The UI's `/jobs` table polls `/jobs?limit=50` every few seconds while any job is `queued` or `running` and computes elapsed time live.

## Service Bus configuration

| Queue | `lock_duration` | `max_delivery_count` | `default_message_ttl` | DLQ on expiry |
|-------|----------------|----------------------|----------------------|---------------|
| `forecast-jobs` | `PT5M` | 5 | `PT2H` | yes |
| `rl-jobs` | `PT5M` | 3 | `PT2H` | yes |

`PT5M` is the **maximum** Service Bus allows. If a worker takes longer than 5 min to call `complete_message`, the lock is lost and the message is redelivered (and the original `complete_message` call raises `MessageLockLostError`).

### Mitigations for long-running jobs

1. **Recommended**: wrap the receiver with `azure.servicebus.AutoLockRenewer(max_lock_renewal_duration=4*3600)` in `dispatcher.py`. Renews the lock in a background thread for as long as needed. Requires rebuilding the `aidemo/forecast` and `aidemo/rl` images (they share `src/common/dispatcher.py`).
2. **Fallback**: keep job size bounded. On the demo cluster PPO does ≈ 740 steps/s, so ≤ ~200 000 steps is a safe demo size.

## KEDA scaling

`deploy/helm/aks-ai-demo/templates/keda.yaml` creates one `TriggerAuthentication` (federated identity) and two `ScaledObject`s:

```yaml
triggers:
  - type: azure-servicebus
    metadata:
      queueName: forecast-jobs           # or rl-jobs
      namespace: aidemo-sb-{random}
      messageCount: "1"                  # 1 pod per pending message
    authenticationRef:
      name: aidemo-sb-auth
```

`minReplicas: 0`, `maxReplicas: 2` (forecast) / `4` (rl). When KEDA scales to 0 and the gpurecon node is empty, the cluster autoscaler removes the node after the cooldown.
