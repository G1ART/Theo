import { renderTheoEmail, theoEmailButton } from "./theoEmail";

const CONFIRM = "{{ .ConfirmationURL }}";
const TOKEN = "{{ .Token }}";
const NEW_EMAIL = "{{ .NewEmail }}";

function linkMail(ko: { title: string; body: string; button: string; ignore: string }, en: { title: string; body: string; button: string; ignore: string }) {
  return renderTheoEmail({
    koHtml: `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;">${ko.title}</h1>
<p style="margin:0 0 12px;">안녕하세요.</p>
<p style="margin:0 0 20px;">${ko.body}</p>
<p style="margin:0 0 20px;">${theoEmailButton(CONFIRM, ko.button)}</p>
<p style="margin:0;font-size:13px;color:#71717a;">${ko.ignore}</p>`,
    enHtml: `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;">${en.title}</h1>
<p style="margin:0 0 12px;">Hello,</p>
<p style="margin:0 0 20px;">${en.body}</p>
<p style="margin:0 0 20px;">${theoEmailButton(CONFIRM, en.button)}</p>
<p style="margin:0;font-size:13px;color:#71717a;">${en.ignore}</p>`,
  });
}

export const AUTH_EMAIL_TEMPLATES = {
  confirmation: {
    subject: "Theo 가입을 확인해 주세요 / Confirm your Theo signup",
    html: linkMail(
      {
        title: "회원가입을 완료해 주세요",
        body: "Theo 가입을 시작해 주셔서 감사합니다. 아래 버튼을 누르면 이메일 인증이 끝나고 가입이 완료됩니다.",
        button: "이메일 인증 완료하기",
        ignore: "직접 가입을 요청하지 않으셨다면 이 메일은 무시하셔도 됩니다.",
      },
      {
        title: "Confirm your signup",
        body: "Thank you for starting your signup with Theo. Use the button below to confirm your email address and finish creating your account.",
        button: "Confirm email address",
        ignore: "If you did not request this, you can safely ignore this email.",
      },
    ),
  },
  magic_link: {
    subject: "Theo 로그인 링크 / Your Theo sign-in link",
    html: linkMail(
      {
        title: "Theo에 로그인하세요",
        body: "아래 버튼은 이 주소로 한 번만 로그인됩니다. 요청하지 않으셨다면 열지 마세요.",
        button: "Theo 로그인",
        ignore: "이 링크는 곧 만료됩니다.",
      },
      {
        title: "Sign in to Theo",
        body: "The button below signs this email address in once. Don't open it if you didn't ask for it.",
        button: "Sign in",
        ignore: "This link expires shortly.",
      },
    ),
  },
  recovery: {
    subject: "Theo 비밀번호 재설정 / Reset your Theo password",
    html: linkMail(
      {
        title: "비밀번호를 다시 설정하세요",
        body: "Theo 비밀번호 재설정 요청이 접수되었습니다. 아래 버튼에서 새 비밀번호를 정하세요.",
        button: "비밀번호 재설정",
        ignore: "요청하지 않으셨다면 이 메일은 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.",
      },
      {
        title: "Reset your password",
        body: "We received a request to reset your Theo password. Choose a new one with the button below.",
        button: "Reset password",
        ignore: "If you didn't request this, you can ignore this email. Your password will stay the same.",
      },
    ),
  },
  invite: {
    subject: "Theo 초대 / You've been invited to Theo",
    html: linkMail(
      {
        title: "Theo에 초대되었습니다",
        body: "아래 버튼으로 초대를 수락하고 계정을 만들어 주세요.",
        button: "초대 수락",
        ignore: "예상하지 못한 초대라면 무시하셔도 됩니다.",
      },
      {
        title: "You've been invited to Theo",
        body: "Accept the invitation and create your account with the button below.",
        button: "Accept invitation",
        ignore: "If you weren't expecting this, you can ignore this email.",
      },
    ),
  },
  email_change: {
    subject: "Theo 이메일 변경 / Confirm your new Theo email",
    html: linkMail(
      {
        title: "새 이메일 주소를 확인해 주세요",
        body: `Theo 계정의 이메일을 ${NEW_EMAIL} 으로 바꾸려는 요청입니다. 아래 버튼으로 확정하세요.`,
        button: "이메일 변경 확인",
        ignore: "요청하지 않으셨다면 이 메일은 무시하셔도 됩니다.",
      },
      {
        title: "Confirm your new email address",
        body: `This confirms ${NEW_EMAIL} as the new address on your Theo account.`,
        button: "Confirm new email",
        ignore: "If you didn't request this change, you can ignore this email.",
      },
    ),
  },
  reauthentication: {
    subject: "Theo 확인 코드 / Your Theo verification code",
    html: renderTheoEmail({
      koHtml: `<h1 style="margin:0 0 12px;font-size:20px;">본인 확인</h1>
<p style="margin:0 0 12px;">민감한 작업을 계속하려면 아래 코드를 입력하세요.</p>
<p style="margin:0;font-size:28px;letter-spacing:0.2em;font-weight:600;">${TOKEN}</p>`,
      enHtml: `<h1 style="margin:0 0 12px;font-size:20px;">Verify it's you</h1>
<p style="margin:0 0 12px;">Enter this code to continue a sensitive action on Theo.</p>
<p style="margin:0;font-size:28px;letter-spacing:0.2em;font-weight:600;">${TOKEN}</p>`,
    }),
  },
} as const;
