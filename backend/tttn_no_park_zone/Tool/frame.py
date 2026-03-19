import cv2

cap = cv2.VideoCapture("data/inputs/videos/videoplayback.mp4")

tong_so_frame = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps           = cap.get(cv2.CAP_PROP_FPS)
thoi_luong    = tong_so_frame / fps   # giây

print(f"Tổng số frame : {tong_so_frame}")
print(f"FPS           : {fps}")
print(f"Thời lượng    : {thoi_luong:.2f}s")

cap.release()