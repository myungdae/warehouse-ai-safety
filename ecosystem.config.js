module.exports = {
  apps: [

    // ─────────────────────────────────────────────
    // 1. DEFCON (gunicorn, port 5000 → defcon.exko.kr)
    // ─────────────────────────────────────────────
    {
      name: 'defcon-webapp',
      script: 'run_gunicorn.sh',
      cwd: '/home/ubuntu/defcon/defcon-web-app',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PYTHONPATH: '/home/ubuntu/defcon/defcon-web-app',
        BACKEND_API_URL: 'http://defcon.exko.kr:8001'
      },
      error_file: '/home/ubuntu/.pm2/logs/defcon-webapp-error.log',
      out_file: '/home/ubuntu/.pm2/logs/defcon-webapp-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 2. WAREHOUSE (flask, port 5002 → warehouse.exko.kr)
    // ─────────────────────────────────────────────
    {
      name: 'warehouse-app',
      script: 'app.py',
      interpreter: 'python3',
      cwd: '/home/ubuntu/warehouse-ai-safety',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/warehouse-app-error.log',
      out_file: '/home/ubuntu/.pm2/logs/warehouse-app-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 3. FRONTIER-CCTV BACKEND (uvicorn, port 8001)
    // ─────────────────────────────────────────────
    {
      name: 'frontier-cctv-backend',
      script: 'backend_venv/bin/uvicorn',
      args: 'api.main:app --host 0.0.0.0 --port 8001',
      interpreter: 'none',
      cwd: '/home/ubuntu/defcon/apps/frontier-cctv/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: '/home/ubuntu/.pm2/logs/frontier-cctv-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/frontier-cctv-backend-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 4. BYTETRACK SERVICE (uvicorn, port 8002)
    // ─────────────────────────────────────────────
    {
      name: 'bytetrack-service',
      script: 'venv/bin/python',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 8002 --workers 1',
      interpreter: 'none',
      cwd: '/home/ubuntu/cctv/bytetrack-service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: '/home/ubuntu/.pm2/logs/bytetrack-service-error.log',
      out_file: '/home/ubuntu/.pm2/logs/bytetrack-service-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 5. CCTV BACKEND NestJS (port 8003)
    // ─────────────────────────────────────────────
    {
      name: 'cctv-backend',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/cctv/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 8003
      },
      error_file: '/home/ubuntu/.pm2/logs/cctv-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/cctv-backend-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 6. YOLO SERVICE (uvicorn, port 8004)
    // ─────────────────────────────────────────────
    {
      name: 'yolo-service',
      script: 'venv/bin/python',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 8004',
      interpreter: 'none',
      cwd: '/home/ubuntu/yolo-service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      error_file: '/home/ubuntu/.pm2/logs/yolo-service-error.log',
      out_file: '/home/ubuntu/.pm2/logs/yolo-service-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 7. APT BACKEND NestJS (port 3010)
    // ─────────────────────────────────────────────
    {
      name: 'apt-backend',
      script: './dist/main.js',
      cwd: '/home/ubuntu/apt/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        PORT: 3010
      },
      error_file: '/home/ubuntu/.pm2/logs/apt-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/apt-backend-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 8. APT FRONTEND (serve -s dist, port 3020)
    // ─────────────────────────────────────────────
    {
      name: 'apt-frontend',
      script: 'npx',
      args: 'serve -s dist -l 3020',
      cwd: '/home/ubuntu/apt/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/apt-frontend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/apt-frontend-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 9. SMART API (node, port 3002)
    // ─────────────────────────────────────────────
    {
      name: 'smart-api',
      script: 'server.js',
      cwd: '/home/ubuntu/smart/api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3002
      },
      error_file: '/home/ubuntu/.pm2/logs/smart-api-error.log',
      out_file: '/home/ubuntu/.pm2/logs/smart-api-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 10. CCTV FRONTEND (serve -s dist, port 5173)
    // ─────────────────────────────────────────────
    {
      name: 'cctv-frontend',
      script: 'npx',
      args: 'serve -s dist -l 5173',
      cwd: '/home/ubuntu/cctv/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/cctv-frontend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/cctv-frontend-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 11. SEMICON FRONTEND (vite preview, port 5003)
    // ─────────────────────────────────────────────
    {
      name: 'semicon-app',
      script: 'node_modules/.bin/vite',
      args: 'preview --port 5003 --host 0.0.0.0',
      cwd: '/home/ubuntu/semicon',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/.pm2/logs/semicon-app-error.log',
      out_file: '/home/ubuntu/.pm2/logs/semicon-app-out.log',
      time: true
    },

    // ─────────────────────────────────────────────
    // 12. SEMICON BACKEND NestJS (port 8005)
    // ─────────────────────────────────────────────
    {
      name: 'semicon-backend',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/semicon/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 8005,
        YOLO_SERVICE_URL: 'http://localhost:8004'
      },
      error_file: '/home/ubuntu/.pm2/logs/semicon-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/semicon-backend-out.log',
      time: true
    }

  ]
};
