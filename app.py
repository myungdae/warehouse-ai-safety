#!/usr/bin/env python3
"""
Warehouse AI Safety System - Flask Application
Real-time sensor monitoring dashboard
"""

from flask import Flask, render_template, send_from_directory
import os

# Initialize Flask app
app = Flask(__name__,
            template_folder='backend/templates',
            static_folder='backend/static')

@app.route('/')
def index():
    """Main dashboard page"""
    return render_template('warehouse_digital_twin.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files"""
    return send_from_directory('backend/static', filename)

@app.route('/ontology/<path:filename>')
def serve_ontology(filename):
    """Serve ontology files"""
    return send_from_directory('backend/ontology', filename)

@app.route('/drone')
def drone_inventory():
    """Drone Inventory Intelligence System"""
    return render_template('drone_inventory.html')

if __name__ == '__main__':
    print("=" * 60)
    print("🏭 Warehouse AI Safety System")
    print("=" * 60)
    print("📊 Starting Flask server on http://0.0.0.0:5002")
    print("🌐 Access: http://localhost:5002")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5002, debug=False)
