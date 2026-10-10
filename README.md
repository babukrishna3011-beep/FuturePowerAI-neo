# FuturePowerAIPlus 3.0.1

Two local 4-bit SmolLM2 ONNX models:
- SmolLM2-135M-Instruct q4f16 for fast/general tasks.
- SmolLM2-1.7B-Instruct q4f16 for deeper mathematics, study, coding, decomposition, TTC and verification.

The app uses device-adaptive profiles, local-first operation, optional user-controlled online information, local conversation storage, custom background support, and a compact SQLite/FTS5 education database.

Models are not bundled in this project ZIP. They are downloaded/cached on first use.

Important: knowledge/education.db in this ZIP is a real tested STARTER database made from the NCERT Class 10 Science sample supplied in the conversation. It is not the final 250–300 MB all-subject CBSE+JEE+NEET pack because that full corpus has not been supplied yet.

Build on Windows:
  npm install
  npm run check
  npm run build:local-ai
  npm run dist:portable

The final education database is built separately with build_edu_db_FINAL_300MB.py.
