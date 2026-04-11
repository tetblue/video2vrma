import torch
import detectron2
print("detectron2:", detectron2.__version__)

from detectron2 import _C
print("detectron2._C loaded from:", _C.__file__)

from detectron2.layers import nms
boxes = torch.tensor([[0, 0, 10, 10], [1, 1, 11, 11], [20, 20, 30, 30]], dtype=torch.float32, device="cuda")
scores = torch.tensor([0.9, 0.8, 0.7], device="cuda")
keep = nms(boxes, scores, iou_threshold=0.5)
print("nms cuda OK; keep=", keep.tolist())
