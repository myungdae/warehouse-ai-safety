#!/bin/bash
# 🚀 Warehouse AI Safety - Quick Deploy
# Copy and paste this entire script to your server

echo "========================================"
echo "🏭 Warehouse AI Safety - Quick Deploy"
echo "========================================"
echo ""

# Step 1: Create required files
echo "📝 Creating project files..."

mkdir -p ~/warehouse-ai-safety/backend/{templates,static/{css,js},ontology}

# Create app.py
cat > ~/warehouse-ai-safety/app.py << 'EOF'
#!/usr/bin/env python3
from flask import Flask, render_template, send_from_directory

app = Flask(__name__,
            template_folder='backend/templates',
            static_folder='backend/static')

@app.route('/')
def index():
    return render_template('warehouse_digital_twin.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('backend/static', filename)

@app.route('/ontology/<path:filename>')
def serve_ontology(filename):
    return send_from_directory('backend/ontology', filename)

if __name__ == '__main__':
    print("🏭 Warehouse AI Safety System")
    print("📊 Starting on http://0.0.0.0:5002")
    app.run(host='0.0.0.0', port=5002, debug=False)
EOF

chmod +x ~/warehouse-ai-safety/app.py

echo "✅ app.py created"

# Step 2: Copy files from defcon
echo ""
echo "📂 Copying files from defcon..."

# Copy HTML
if [ -f ~/defcon/defcon-web-app/templates/warehouse_digital_twin.html ]; then
    cp ~/defcon/defcon-web-app/templates/warehouse_digital_twin.html \
       ~/warehouse-ai-safety/backend/templates/
    echo "✅ HTML copied"
fi

# Copy CSS
if [ -f ~/defcon/defcon-web-app/static/css/warehouse.css ]; then
    cp ~/defcon/defcon-web-app/static/css/warehouse.css \
       ~/warehouse-ai-safety/backend/static/css/
    echo "✅ warehouse.css copied"
fi

# Copy JS
if [ -f ~/defcon/defcon-web-app/static/js/warehouse_digital_twin.js ]; then
    cp ~/defcon/defcon-web-app/static/js/warehouse_digital_twin.js \
       ~/warehouse-ai-safety/backend/static/js/
    echo "✅ JavaScript copied"
fi

# Copy ontology files
if [ -d ~/defcon ]; then
    cp ~/defcon/warehouse_traffic_*.* ~/warehouse-ai-safety/backend/ontology/ 2>/dev/null || true
    echo "✅ Ontology files copied"
fi

# Step 3: Install Flask
echo ""
echo "📦 Installing Flask..."
if ! python3 -c "import flask" 2>/dev/null; then
    pip3 install flask || sudo apt install python3-flask -y
    echo "✅ Flask installed"
else
    echo "✅ Flask already installed"
fi

# Step 4: Start with PM2
echo ""
echo "🚀 Starting warehouse-app..."
pm2 delete warehouse-app 2>/dev/null || true
cd ~/warehouse-ai-safety
pm2 start app.py --name warehouse-app --interpreter python3
pm2 save

# Step 5: Test
echo ""
echo "🧪 Testing..."
sleep 2
if curl -f -s http://localhost:5002 > /dev/null; then
    echo "✅ App is running!"
else
    echo "❌ App failed to start. Check logs:"
    pm2 logs warehouse-app --lines 20 --nostream
    exit 1
fi

# Final status
echo ""
echo "========================================"
echo "✅ Deployment Complete!"
echo "========================================"
echo ""
echo "📊 PM2 Status:"
pm2 list
echo ""
echo "🌐 Access:"
echo "   Local:  http://localhost:5002"
echo "   Public: https://warehouse.exko.kr"
echo ""
echo "📋 Next:"
echo "   pm2 logs warehouse-app    # View logs"
echo "   pm2 restart warehouse-app # Restart"
echo ""
