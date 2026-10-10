# Getting the two 4-bit local models

The app is configured to use the upstream Hugging Face SmolLM2 model IDs with Transformers.js and q4f16.

135M model:
https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX/tree/main/onnx
Current q4f16 file size: about 117 MB.

1.7B model:
https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct/tree/main/onnx
Current q4f16 file size: about 1.11 GB.

Simplest method:
1. Build/run the app with Internet enabled for the first model download.
2. Transformers.js downloads the model/config/tokenizer files and caches them.
3. Later runs can use the cached models without downloading them again.

Optional Hugging Face CLI method:
  pip install -U huggingface_hub
  hf download onnx-community/SmolLM2-135M-Instruct-ONNX --local-dir models/135m
  hf download HuggingFaceTB/SmolLM2-1.7B-Instruct --include "onnx/*" --include "*.json" --include "*.txt" --local-dir models/1.7b

Keep the original filenames and supporting tokenizer/config files.
