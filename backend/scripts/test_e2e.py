import argparse
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.pipeline import run_e2e


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", default="dance.mp4")
    p.add_argument("--output", default="tmp/phase1")
    p.add_argument("--end-frame", type=int, default=-1, help="-1 表示跑整支影片")
    p.add_argument("--fps", type=int, default=30)
    args = p.parse_args()

    import torch
    print(f"[cuda] available={torch.cuda.is_available()} "
          f"device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A'} "
          f"capability={torch.cuda.get_device_capability(0) if torch.cuda.is_available() else 'N/A'}")
    if torch.cuda.is_available():
        _ = torch.zeros(1, device="cuda") + 1  # warm up, forces context
        torch.cuda.synchronize()
        print(f"[cuda] mem_allocated={torch.cuda.memory_allocated()/1e6:.1f}MB")

    t0 = time.time()
    result = run_e2e(
        video_path=args.video,
        output_dir=args.output,
        end_frame=args.end_frame,
        fps=args.fps,
    )
    dt = time.time() - t0
    print(f"\n[OK] Phase 1 e2e completed in {dt:.1f}s")
    print(f"  PKL: {result['pkl']}")
    print(f"  BVH: {result['bvh']} ({result['bvh'].stat().st_size} bytes)")
    if "gif" in result:
        print(f"  GIF: {result['gif']} ({result['gif'].stat().st_size} bytes)")
    if "overlay" in result:
        print(f"  OVERLAY: {result['overlay']} ({result['overlay'].stat().st_size} bytes)")


if __name__ == "__main__":
    main()
