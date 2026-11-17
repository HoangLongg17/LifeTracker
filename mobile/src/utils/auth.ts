export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

export function loginError(error: unknown): { field?: 'email' | 'password'; message: string } {
  switch (errorCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return { field: 'password', message: 'Email hoặc mật khẩu chưa đúng. Kiểm tra lại thông tin đăng nhập.' };
    case 'auth/invalid-email':
      return { field: 'email', message: 'Vui lòng nhập email hợp lệ.' };
    case 'auth/user-disabled':
      return { message: 'Tài khoản này đã bị vô hiệu hóa.' };
    case 'auth/too-many-requests':
      return { message: 'Bạn đã thử đăng nhập nhiều lần. Vui lòng thử lại sau.' };
    case 'auth/network-request-failed':
      return { message: 'Không thể kết nối. Kiểm tra kết nối mạng rồi thử lại.' };
    default:
      return { message: 'Không thể đăng nhập lúc này. Vui lòng thử lại.' };
  }
}
