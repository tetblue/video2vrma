@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1

set CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8
set DISTUTILS_USE_SDK=1
set TORCH_CUDA_ARCH_LIST=12.0
set FORCE_CUDA=1
set MAX_JOBS=4

call conda run --no-capture-output -n aicuda pip install --no-build-isolation "git+https://github.com/facebookresearch/detectron2.git"
exit /b %errorlevel%
