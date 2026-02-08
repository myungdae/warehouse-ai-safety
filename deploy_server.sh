#!/bin/bash
# Warehouse AI Safety - Server Deployment Script
# This script deploys the warehouse monitoring system to the server

set -e

echo "========================================"
echo "🏭 Warehouse AI Safety - Server Deploy"
echo "========================================"

# Configuration
PROJECT_DIR="$HOME/warehouse-ai-safety"

# Step 1: Check if directory exists
if [ -d "$PROJECT_DIR" ]; then
    echo "📁 Project directory exists: $PROJECT_DIR"
    cd "$PROJECT_DIR"
else
    echo "❌ Error: Project directory not found: $PROJECT_DIR"
    exit 1
fi

# Step 2: Install Flask if not installed
echo ""
echo "📦 Checking Flask installation..."
if ! python3 -c "import flask" 2>/dev/null; then
    echo "Installing Flask..."
    pip3 install flask || sudo apt install python3-flask -y
else
    echo "✅ Flask is already installed"
fi

# Step 3: Check file structure
echo ""
echo "📂 Checking project structure..."
required_files=(
    "app.py"
    "backend/templates/warehouse_digital_twin.html"
    "backend/static/css/style.css"
    "backend/static/css/warehouse_sensor.css"
    "backend/static/js/warehouse_sensor.js"
)

missing_files=0
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ Missing: $file"
        missing_files=$((missing_files + 1))
    fi
done

if [ $missing_files -gt 0 ]; then
    echo ""
    echo "⚠️  Warning: $missing_files file(s) missing"
    echo "Please upload missing files before continuing"
    exit 1
fi

# Step 4: Stop existing PM2 process
echo ""
echo "🛑 Stopping existing warehouse-app..."
pm2 delete warehouse-app 2>/dev/null || echo "No existing process to stop"

# Step 5: Start Flask app with PM2
echo ""
echo "🚀 Starting warehouse-app with PM2..."
pm2 start app.py --name warehouse-app --interpreter python3

# Step 6: Save PM2 configuration
echo ""
echo "💾 Saving PM2 configuration..."
pm2 save

# Step 7: Check status
echo ""
echo "📊 Checking PM2 status..."
pm2 list

# Step 8: Test Flask endpoint
echo ""
echo "🧪 Testing Flask endpoint..."
sleep 2
if curl -f -s http://localhost:5002 > /dev/null; then
    echo "✅ Flask app is running on port 5002"
else
    echo "❌ Flask app is not responding on port 5002"
    echo "Checking logs:"
    pm2 logs warehouse-app --lines 20 --nostream
    exit 1
fi

# Step 9: Check if defcon is still running
echo ""
echo "🔍 Verifying defcon-webapp is not affected..."
if pm2 list | grep -q "defcon-webapp.*online"; then
    echo "✅ defcon-webapp is still running"
else
    echo "⚠️  Warning: defcon-webapp may not be running"
fi

echo ""
echo "========================================"
echo "✅ Deployment Complete!"
echo "========================================"
echo ""
echo "🌐 Access URLs:"
echo "   Local:  http://localhost:5002"
echo "   Public: https://warehouse.exko.kr"
echo ""
echo "📋 Next Steps:"
echo "   1. Verify Nginx configuration:"
echo "      sudo nginx -t"
echo ""
echo "   2. Reload Nginx if needed:"
echo "      sudo systemctl reload nginx"
echo ""
echo "   3. Check DNS propagation:"
echo "      nslookup warehouse.exko.kr"
echo ""
echo "   4. View logs:"
echo "      pm2 logs warehouse-app"
echo ""
echo "========================================"
