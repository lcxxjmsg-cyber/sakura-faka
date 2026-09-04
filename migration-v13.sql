-- P1-3: 归集任务 lease（防止并发 Worker 同时处理同一任务）
ALTER TABLE sweep_tasks ADD COLUMN lease_until TEXT NULL;
