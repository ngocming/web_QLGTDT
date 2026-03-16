<?php
// 1. Kết nối Database
$conn = mysqli_connect("localhost", "root", "", "quanlydothi");

// 2. Truy vấn lấy dữ liệu
$sql = "SELECT t.TenDangNhap, n.TenQuyen 
        FROM TaiKhoan t 
        JOIN NhomQuyen n ON t.ID_NhomQuyen = n.ID_NhomQuyen";
$result = mysqli_query($conn, $sql);
?>

<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quản Lý Đô Thị - Cường Đỗ</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

    <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4">
        <div class="container">
            <a class="navbar-brand" href="#">SMART CITY - CUONG DO</a>
        </div>
    </nav>

    <div class="container">
        <div class="row">
            <div class="col-md-4 mb-4">
                <div class="card bg-success text-white shadow">
                    <div class="card-body text-center">
                        <h6 class="text-uppercase">Tổng phương tiện</h6>
                        <h2 class="display-4">1,250</h2>
                    </div>
                </div>
            </div>
            <div class="col-md-4 mb-4">
                <div class="card bg-danger text-white shadow">
                    <div class="card-body text-center">
                        <h6 class="text-uppercase">Xe vi phạm hôm nay</h6>
                        <h2 class="display-4">14</h2>
                    </div>
                </div>
            </div>
            <div class="col-md-4 mb-4">
                <div class="card bg-info text-white shadow">
                    <div class="card-body text-center">
                        <h6 class="text-uppercase">Camera hoạt động</h6>
                        <h2 class="display-4">98%</h2>
                    </div>
                </div>
            </div>
            <div class="col-md-12">
                <div class="card shadow">
                    <div class="card-header bg-primary text-white">
                        <h5 class="mb-0">DANH SÁCH NGƯỜI DÙNG HỆ THỐNG</h5>
                    </div>
                    <div class="card-body">
                        <table class="table table-bordered table-hover">
                            <thead class="table-light">
                                <tr>
                                    <th>Tên Đăng Nhập</th>
                                    <th>Quyền Hạn</th>
                                    <th class="text-center">Thao Tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php while($row = mysqli_fetch_assoc($result)) { ?>
                                <tr>
                                    <td><strong><?php echo $row['TenDangNhap']; ?></strong></td>
                                    <td><span class="badge bg-info text-dark"><?php echo $row['TenQuyen']; ?></span></td>
                                    <td class="text-center">
                                        <button class="btn btn-sm btn-warning">Sửa</button>
                                        <button class="btn btn-sm btn-danger">Xóa</button>
                                    </td>
                                </tr>
                                <?php } ?>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>