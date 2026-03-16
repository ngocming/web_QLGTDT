<?php
session_start();
$conn = mysqli_connect("localhost", "root", "", "quanlydothi");

$user = $_POST['user'];
$pass = $_POST['pass'];

// Kiểm tra trong Database
$sql = "SELECT * FROM TaiKhoan WHERE TenDangNhap='$user' AND MatKhau='$pass'";
$result = mysqli_query($conn, $sql);

if (mysqli_num_rows($result) > 0) {
    // Đăng nhập đúng -> Lưu vào bộ nhớ tạm (Session) và đi tới trang Admin
    $_SESSION['admin'] = $user;
    header("Location: admin.php");
} else {
    // Sai thì báo lỗi và quay lại trang login
    echo "<script>alert('Sai tài khoản hoặc mật khẩu!'); window.location='login.php';</script>";
}
?>