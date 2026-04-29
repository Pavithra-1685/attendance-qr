const mongoose = require('mongoose');

const medicalRequestSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  universityRollNo: { type: String, required: true },
  name: { type: String, required: true },
  reason: { type: String, required: true },
  status: { 
    type: String, 
    enum: ["Pending", "Approved", "Rejected", "Confirmed", "Expired"], 
    default: "Pending" 
  },
  proofDocument: { type: String }, // URL or file path
  timestamp: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('MedicalRequest', medicalRequestSchema);
