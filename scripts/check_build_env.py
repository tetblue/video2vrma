import os
import shutil
import subprocess

print("CUDA_HOME =", os.environ.get("CUDA_HOME"))
print("CUDA_PATH =", os.environ.get("CUDA_PATH"))
print("DISTUTILS_USE_SDK =", os.environ.get("DISTUTILS_USE_SDK"))

for tool in ["nvcc", "cl", "ninja", "cmake"]:
    path = shutil.which(tool)
    print(f"{tool}: {path}")

try:
    out = subprocess.check_output(["nvcc", "--version"], text=True, stderr=subprocess.STDOUT)
    print("--- nvcc ---\n" + out.strip())
except Exception as e:
    print(f"nvcc run failed: {e}")

import torch
print("--- torch ---")
print("torch:", torch.__version__)
print("cuda:", torch.version.cuda)
print("capability:", torch.cuda.get_device_capability(0) if torch.cuda.is_available() else "N/A")
print("TORCH_CUDA_ARCH_LIST =", os.environ.get("TORCH_CUDA_ARCH_LIST"))
