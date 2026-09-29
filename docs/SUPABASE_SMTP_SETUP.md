# Supabase 커스텀 SMTP 설정 가이드

온보딩을 오픈 형태로 운영할 때 Supabase 기본 이메일 제한을 우회하기 위한 가이드.

## Supabase 기본 제한

- **시간당 2통** 이메일 제한
- **팀 멤버 이메일만** 발송 가능 (미승인 주소는 `Email address not authorized` 에러)
- 프로덕션/베타용 아님 (데모·개발용만)

→ 커스텀 SMTP를 설정하면 이 제한이 해제된다.

---

## 설정 방법

### 1. 설정 위치

Supabase Dashboard → **Authentication** → **SMTP Settings** (또는 **Email** 탭)

### 2. 지원 서비스 예시

| 서비스 | 특징 | 무료 티어 |
|--------|------|-----------|
| **Resend** | Supabase와 연동 용이, 설정 단순 | 일 100통 / 월 3,000통 |
| **Brevo** | 무료 티어 넉넉 | 일 300통 |
| **SendGrid** | 널리 사용 | 일 100통 |
| **ZeptoMail** | 아시아 수신에 유리 | 월 10,000통 |

### 3. Resend 설정 예시

1. [Resend](https://resend.com) 가입 → API Key 생성
2. Supabase SMTP Settings에 입력:
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: Resend API Key
   - **Sender email**: `no-reply@yourdomain.com` (검증된 도메인)
   - **Sender name**: `Theo`

3. 저장 후 → **모든 이메일 주소**로 발송 가능 (팀 멤버 제한 해제)
4. Rate Limits (Supabase → Auth → Rate Limits)에서 초당·시간당 제한 조정 가능

### 4. Brevo 설정 예시

- Host: `smtp-relay.brevo.com`
- Port: `587` (TLS)
- Username: Brevo 로그인 이메일
- Password: SMTP 키 (Brevo → SMTP & API → Generate SMTP key)

---

## 권장 사항

1. **커스텀 도메인 사용**: `noreply@withtheo.art` 등으로 발신자 설정 (스팸 방지)
2. **도메인 검증**: Resend/Brevo에서 DKIM, SPF, DMARC 설정
3. **CAPTCHA 도입**: 회원가입 폼에 [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha) 적용 (봇 가입 방지)

---

## 참고 링크

- [Supabase: Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend + Supabase 연동](https://resend.com/docs/send-with-supabase-smtp)
