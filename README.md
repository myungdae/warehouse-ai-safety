# 🏭 Warehouse AI Safety System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Ontology](https://img.shields.io/badge/Ontology-OWL%2FSWRL-green.svg)](https://www.w3.org/OWL/)

**AI-powered Warehouse Safety System with Ontology-based Decision Support**

Prevent forklift collisions using real-time sensor fusion, semantic reasoning, and voice command intervention.

---

## 🎯 **Overview**

This system demonstrates a **Decision Support System** (not autonomous control) that:

- 🚛 Tracks forklifts and pedestrians in real-time
- ⚠️ Detects collision risks using multi-modal sensors (CCTV, LiDAR, UWB)
- 🔊 Issues voice commands to operators
- 🧠 Uses ontology-based reasoning (OWL, SWRL, SHACL)
- 📊 Logs all events for accountability

**Key Principle**: **Human-in-the-loop** - System advises, operators decide.

---

## 📁 **Project Structure**

```
warehouse-ai-safety/
├── backend/
│   ├── ontology/
│   │   ├── warehouse_traffic_ontology.ttl   # OWL ontology
│   │   ├── warehouse_traffic_rules.swrl     # SWRL reasoning rules
│   │   ├── warehouse_traffic_validation.shacl # SHACL constraints
│   │   └── warehouse_traffic_examples.ttl   # Sample data
│   ├── static/
│   │   ├── css/
│   │   │   └── warehouse.css
│   │   └── js/
│   │       └── warehouse_digital_twin.js
│   └── templates/
│       └── warehouse_digital_twin.html
├── docs/
│   ├── ONTOLOGY_EXPLANATION.md              # Technical architecture
│   └── consultation/
│       ├── CONSULTATION_WAREHOUSE_DIGITAL_TWIN.md
│       └── PPT_PRESENTATION_SCRIPT.md
└── README.md
```

---

## 🚀 **Features**

### **Current (PoC/Demo)**
- ✅ Real-time warehouse map visualization
- ✅ 4 forklift tracking simulation
- ✅ Sensor monitoring (8 CCTV, 6 LiDAR, 6 UWB)
- ✅ Collision detection with risk zones
- ✅ Voice command system (Web Speech API)
- ✅ 3 scenario demos (collision/pedestrian/speeding)
- ✅ Ontology-based architecture

### **Planned (Production)**
- 🔜 Real CCTV feed integration
- 🔜 UWB tag data ingestion
- 🔜 LiDAR point cloud processing
- 🔜 YOLOv8 object detection
- 🔜 Pellet/HermiT reasoning engine
- 🔜 Physical speaker integration
- 🔜 PostgreSQL + Timescale event storage
- 🔜 Mobile app for supervisors

---

## 🧠 **Ontology Architecture**

### **Core Classes**
- `MovingEntity`: Forklifts, pedestrians, equipment
- `Zone`: Aisles, intersections, blind corners, pedestrian zones
- `Sensor`: CCTV, LiDAR, UWB, proximity, audio
- `Event`: Position, speed, proximity, collision risk
- `Action`: Voice command, speed limit, forced stop

### **SWRL Rules**
```swrl
# Rule 1: Collision Risk Detection
Forklift(?f1) ∧ Forklift(?f2) ∧ 
distance(?f1, ?f2, ?d) ∧ swrlb:lessThan(?d, 5.0) 
→ CollisionRiskEvent(?event) ∧ involvesEntity(?event, ?f1)

# Rule 2: Pedestrian Proximity Warning
Forklift(?f) ∧ Pedestrian(?p) ∧ 
distance(?f, ?p, ?d) ∧ swrlb:lessThan(?d, 8.0)
→ VoiceCommand(?cmd) ∧ targetedAt(?cmd, ?f) ∧ commandType(?cmd, "STOP")
```

---

## 📊 **Demo Scenarios**

### **Scenario 1: Forklift Collision Prevention**
- Two forklifts approach intersection
- System detects collision risk (distance < 5m)
- Voice command: "F-07! Stop! Check intersection!"
- Forklifts halt, collision prevented ✅

### **Scenario 2: Pedestrian Proximity**
- Forklift approaches pedestrian zone
- Pedestrian detected within 8m
- Voice command: "F-03! Emergency stop! Pedestrian!"
- Forklift stops immediately ✅

### **Scenario 3: Speeding in Pedestrian Zone**
- Forklift enters pedestrian zone at 15 km/h (limit: 5 km/h)
- Speed violation detected
- Voice command: "F-15! Slow down! Pedestrian zone!"
- Speed reduced to safe level ✅

---

## 💰 **ROI Calculation**

| Item | Value |
|------|-------|
| **Investment** | ₩230M |
| **Annual Savings** | ₩500-600M |
| **Payback Period** | 6 months |
| **ROI** | 117% (Year 1) |

**Cost Breakdown**:
- Sensors: ₩150M (8 CCTV, 20 UWB, 6 LiDAR)
- Software: ₩50M (AI, ontology, integration)
- Installation: ₩30M

**Savings**:
- Accident prevention: ₩300M/year (avg. ₩50M per incident × 6 prevented)
- Insurance: ₩80M/year (premium reduction)
- Productivity: ₩120M/year (downtime reduction)

---

## 🛠️ **Technology Stack**

### **Backend**
- Python 3.8+ (Flask)
- Owlready2 (Ontology reasoning)
- OpenCV + YOLOv8 (Object detection)
- PostgreSQL + Timescale (Time-series DB)

### **Frontend**
- HTML5 + CSS3 + JavaScript
- SVG for real-time map
- Web Speech API for TTS

### **Ontology**
- OWL 2 (Web Ontology Language)
- SWRL (Semantic Web Rule Language)
- SHACL (Shapes Constraint Language)
- Pellet/HermiT reasoner

### **Sensors**
- CCTV: IP cameras (RTSP/HTTP)
- UWB: Ultra-Wideband RTLS (±30cm accuracy)
- LiDAR: 3D scanning sensors
- Audio: Network speakers

---

## 📖 **Documentation**

- **[Ontology Architecture](docs/ONTOLOGY_EXPLANATION.md)**: Technical details
- **[Consultation Guide](docs/consultation/CONSULTATION_WAREHOUSE_DIGITAL_TWIN.md)**: Business case
- **[Presentation Script](docs/consultation/PPT_PRESENTATION_SCRIPT.md)**: Sales deck

---

## 🎯 **Use Cases**

### **Logistics Centers**
- CJ Logistics, Coupang, Lotte Global Logistics
- 50-100 forklifts, 200+ workers

### **Manufacturing Plants**
- Automotive, Electronics, Heavy machinery
- Mixed traffic: AGVs, forklifts, pedestrians

### **Ports & Terminals**
- Container yards, cargo handling
- Large-scale operations

### **Airports**
- Ground support equipment (GSE)
- Tarmac safety

---

## 🔗 **Related Projects**

- **[DEFCON](https://github.com/myungdae/defcon)**: Defense drone surveillance system (military)
- **Warehouse AI Safety** (this project): Industrial safety system (civilian)

**Shared Technology**:
- Ontology-based reasoning
- Multi-modal sensor fusion
- Decision Support System philosophy

---

## 📄 **License**

MIT License - See [LICENSE](LICENSE) file for details

---

## 👥 **Authors**

- **Myungdae Kim** - Initial work - [myungdae](https://github.com/myungdae)

---

## 🙏 **Acknowledgments**

- Ontology design inspired by Palantir's case record system
- Sensor fusion techniques from autonomous vehicle research
- Human-in-the-loop principle from aviation safety systems

---

## 📧 **Contact**

For business inquiries or technical questions:
- GitHub Issues: [Create an issue](https://github.com/myungdae/warehouse-ai-safety/issues)
- Email: [Contact via GitHub profile]

---

**Built with ❤️ for safer workplaces**
