
try:
    import torch
    print(f"Torch version: {torch.__version__}")
    print(f"Torch cuda available: {torch.cuda.is_available()}")
except ImportError as e:
    print(f"Torch import failed: {e}")

try:
    import transformers
    print(f"Transformers version: {transformers.__version__}")
    from transformers import PreTrainedModel
    print("PreTrainedModel imported successfully")
except Exception as e:
    print(f"Transformers import failed: {e}")
    import traceback
    traceback.print_exc()
