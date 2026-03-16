<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>Đăng nhập hệ thống - Cường Đỗ</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-secondary">
    <div class="container mt-5">
        <div class="row justify-content-center">
            <div class="col-md-4">
                <div class="card shadow">
                    <div class="card-body">
                        <h4 class="text-center mb-4">ĐĂNG NHẬP</h4>
                        <form action="xuly_login.php" method="POST">
                            <div class="mb-3">
                                <label>Tên đăng nhập:</label>
                                <input type="text" name="user" class="form-control" required>
                            </div>
                            <div class="mb-3">
                                <label>Mật khẩu:</label>
                                <input type="password" name="pass" class="form-control" required>
                            </div>
                            <button type="submit" class="btn btn-primary w-100">Vào hệ thống</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>