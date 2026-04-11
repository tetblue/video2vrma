import torch
import pytorch3d
print("pytorch3d:", pytorch3d.__version__)

from pytorch3d.structures import Meshes
verts = torch.rand(1, 10, 3, device="cuda")
faces = torch.randint(0, 10, (1, 5, 3), device="cuda")
mesh = Meshes(verts=verts, faces=faces)
print("Meshes on cuda OK; num_verts=", mesh.num_verts_per_mesh().tolist())

from pytorch3d.ops import knn_points
x = torch.rand(1, 100, 3, device="cuda")
y = torch.rand(1, 100, 3, device="cuda")
d = knn_points(x, y, K=3)
print("knn_points cuda OK; dists.shape=", d.dists.shape)
