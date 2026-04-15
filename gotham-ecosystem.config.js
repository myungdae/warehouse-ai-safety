module.exports = {
  apps: [{
    name: 'gotham-api',
    script: '/home/ubuntu/defcon/defcon-web-app/venv/bin/python3',
    args: '-m uvicorn gotham_backend:app --host 0.0.0.0 --port 8766',
    cwd: '/home/ubuntu/defcon/defcon-web-app/gotham',
    interpreter: 'none',
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      PYTHONPATH: '/home/ubuntu/defcon/defcon-web-app/gotham'
    },
    error_file: '/home/ubuntu/.pm2/logs/gotham-api-error.log',
    out_file: '/home/ubuntu/.pm2/logs/gotham-api-out.log'
  }]
};
