export function validateRegistration(email: string, password: string, confirmation: string) {
  const errors: { email?: string; password?: string; confirmation?: string } = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Vui lòng nhập email hợp lệ.';
  }
  if (password.length < 8) errors.password = 'Mật khẩu cần ít nhất 8 ký tự.';
  if (password.length > 128) errors.password = 'Mật khẩu không được quá 128 ký tự.';
  if (confirmation !== password) errors.confirmation = 'Mật khẩu nhập lại không khớp.';
  return errors;
}

export function registrationError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Email này đã được đăng ký. Vui lòng đăng nhập.',
    'auth/invalid-email': 'Vui lòng nhập email hợp lệ.',
    'auth/weak-password': 'Mật khẩu chưa đáp ứng yêu cầu bảo mật.',
    'auth/password-does-not-meet-requirements': 'Mật khẩu chưa đáp ứng chính sách bảo mật của ứng dụng.',
    'auth/network-request-failed': 'Không có kết nối mạng. Vui lòng thử lại.',
    'auth/too-many-requests': 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
  };
  return messages[code] ?? 'Không thể đăng ký lúc này. Vui lòng thử lại.';
}
