# FuturePowerAIPlus 3.0.0

## Changed
- Replaced the previous LFM/Qwen prototype with two 4-bit SmolLM2 ONNX models.
- Fast model: SmolLM2-135M-Instruct q4f16.
- Deep model: SmolLM2-1.7B-Instruct q4f16.
- Added device-adaptive Saver/Balanced/Performance profiles.
- Added task decomposition, TTC verification/revision and secure code-review passes.
- Added explicit Internet when needed toggle; online access is off by default.
- Added IndexedDB conversation saving/export and local custom backgrounds.
- Added an improved 250-300 MB target SQLite + FTS5 education builder.
- Added provenance fields and page-aware PDF ingestion.
- Added a clean download website with three app choices using the same two models.

## Important packaging note
Model weights are downloaded/cached separately rather than bundled into the application archive. This is necessary to keep the core package lightweight.
