/**
 * Korean copy for guided tours — stored as UTF-8 string literals in this file
 * so the overlay never resolves long KR through `messages.ts` / `t()` at runtime.
 * English and keys in `tourRegistry.ts` stay the i18n path; edit both when copy changes.
 */

/**
 * Tour popover / help: never lead with Geist. Variable Latin + composited overlay
 * has produced wrong glyphs for both EN and KR in some Chromium/WebKit builds.
 */
export const TOUR_POPOVER_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

export const TOUR_KO_CHROME = {
  next: "다음",
  prev: "이전",
  skip: "건너뛰기",
  done: "완료",
  reopen: "가이드 보기",
} as const;

/** Tour id → small eyebrow label in the popover */
export const TOUR_KO_HEADER: Record<string, string> = {
  "studio.main": "스튜디오 안내",
  "upload.main": "업로드 안내",
  "exhibition.create": "전시 게시물 안내",
  "exhibition.detail": "전시 게시물 관리",
  "board.detail": "보드 안내",
  "profile.identity": "프로필 정체성 안내",
  "people.main": "사람 찾기",
  "delegation.main": "위임 안내",
  "network.main": "네트워크 안내",
  "profile.public": "공개 프로필 미리보기",
};

/** `${tourId}:${stepId}` → title + body */
export const TOUR_KO_STEP: Record<string, { title: string; body: string }> = {
  "studio.main:hero": {
    title: "내 스튜디오에 오신 걸 환영해요",
    body: "Theo에서 만들고, 담고, 공유하는 모든 것이 시작되는 공간이에요.",
  },
  "studio.main:next-steps": {
    title: "다음으로 해보면 좋은 일",
    body: "지금 스튜디오에 도움이 될 만한 일을 간단히 모아두는 곳이에요. 프로필·작품·문의를 바로 열 수 있어요.",
  },
  "studio.main:grid": {
    title: "운영 타일",
    body: "작업실·보드·전시처럼 스튜디오 운영에 필요한 여덟 개 모듈을 한 자리에 모아두었어요.",
  },
  "studio.main:workshop": {
    title: "작업실",
    body: "비공개·작업 중·보관 중인 작품을 관리하는 공간이에요. 공개 스튜디오와는 분리돼 있어요.",
  },
  "studio.main:boards": {
    title: "보드",
    body: "작품이나 전시를 한데 모아 검토·공유하는 묶음이에요. 리뷰·제안·다음 전시 준비에 잘 어울려요.",
  },
  "studio.main:exhibitions": {
    title: "전시",
    body: "이미 진행했거나 진행 중, 또는 예정된 전시를 소개하는 게시물을 만드는 곳이에요.",
  },
  "studio.main:public-works": {
    title: "공개 프로필에 보이는 작품",
    body: "이 탭 줄은 공개 프로필과 맞춰져 있어요. 공개로 두신 작품·전시만 여기서 다루고, 방문자가 프로필에서 처음 보게 되는 구성이에요.",
  },
  "studio.main:portfolio-tabs": {
    title: "탭으로 정리하기",
    body: '여기서는 탭 구성을 다뤄요. ↕로 탭 순서를 바꾸고, ⚙에서 기본 탭 이름을 바꾸거나 나만의 탭을 만들고 공개 여부를 정할 수 있어요. 탭 안의 작품 순서는 "공개 프로필 미리보기"에서 [순서 변경] 버튼으로 바꾸면 돼요. 방문자에게 보이는 진열은 그 페이지가 단일 기준점이에요.',
  },
  "studio.main:ai-helpers": {
    title: "AI는 옆에서 거드는 역할이에요",
    body: "프로필·작품·전시 카드는 초안과 체크리스트를 돕는 보조자예요. 자동으로 수정·발행·전송하는 일은 없고, [복사] 같은 버튼을 눌러야 비로소 반영돼요.",
  },

  "upload.main:website-import": {
    title: "홈페이지에서 가져오기",
    body: "이미지를 먼저 올린 뒤 홈페이지 URL을 주면 캡션과 이미지를 함께 살펴봐 매칭 후보를 정리해드려요. 결과는 검토해서 [적용]을 눌러야 반영되고, 자동으로 공개되지는 않아요.",
  },

  "board.detail:header": {
    title: "보드 한눈에 살피기",
    body: "보드는 작품·전시를 한데 모아 검토·공유·다음 전시 준비에 쓰는 묶음이에요. 제목과 메모를 자유롭게 다듬어 보드의 의도를 분명히 해주세요.",
  },
  "board.detail:share": {
    title: "공유 링크와 협업",
    body: "공유 링크를 켜고 끄거나 토큰을 새로 발급할 수 있어요. 받은 분은 별도 로그인 없이 살펴볼 수 있고, 협업자는 따로 초대하면 함께 편집할 수 있어요.",
  },
  "board.detail:pitch-pack": {
    title: "보드 → 피치 팩",
    body: "보드의 흐름·이메일 초안·작품별 설명을 한 묶음으로 정리해드려요. 결과는 항상 초안이고, 그대로 보내거나 발행하지 않아요. [복사]·[붙여넣기]는 사용자가 결정해요.",
  },
  "board.detail:items": {
    title: "보드 안의 항목",
    body: "여기에 모인 작품·전시는 보드의 흐름 그 자체예요. 항목을 추가·정리하면 위쪽 [전시 게시물로 만들기]나 [피치 팩]에 자연스럽게 이어져요.",
  },

  "exhibition.detail:header": {
    title: "전시 게시물 관리",
    body: "여기는 이미 만든 전시 게시물을 다듬는 공간이에요. 정보 수정, 작품 추가/제거, 권한 공유까지 한 화면에서 다룰 수 있어요.",
  },
  "exhibition.detail:review": {
    title: "전시 기록 검토",
    body: "전시 게시물의 빠진 정보·약한 부분을 가볍게 점검해드려요. 결과는 항상 제안이고, 사용자가 검토해 직접 반영해주세요.",
  },
  "exhibition.detail:media": {
    title: "참여 작가별 미디어",
    body: "참여 작가별로 작품·설치 전경 이미지를 정리하고 순서를 바꿀 수 있어요. 드래그로 의도한 흐름대로 배치해주세요.",
  },

  "profile.identity:avatar": {
    title: "프로필 사진",
    body: "공개 프로필 곳곳에 노출되는 작은 사진이에요. 정사각형으로 잘리니 얼굴/로고가 가운데 오게 골라주세요. 올리면 즉시 미리보기가 갱신돼요.",
  },
  "profile.identity:cover": {
    title: "커버 이미지",
    body: "공개 프로필 상단 띠로 보이는 큰 이미지예요. 슬라이더로 노출 위치를 위·아래로 옮길 수 있고, 미리보기로 잘리는 영역을 바로 확인할 수 있어요.",
  },
  "profile.identity:bio": {
    title: "짧은 소개",
    body: "처음 만나는 사람에게 건네는 한두 줄 인사예요. 무엇을 하는 사람인지, 어디에서 어떻게 일하는지 가볍게 적어주세요.",
  },
  "profile.identity:statement": {
    title: "작가의 말 (Artist Statement)",
    body: "내 작업의 맥락·관심·태도를 깊이 있게 풀어내는 글이에요. 짧은 소개와 달리 호흡이 길고, 큐레이터·컬렉터가 작업을 이해할 때 큰 도움이 돼요. 필요하면 AI로 초안을 받아 다듬어보세요.",
  },

  "profile.public:tabs": {
    title: "내 스튜디오와 같은 탭 구성",
    body: "여기 탭은 내 스튜디오에서 설정한 그대로예요. 탭 추가·이름 변경·순서·공개 여부는 내 스튜디오에서, 탭 안에 무엇이 어떤 순서로 보이는지는 이 페이지에서 정해요.",
  },
  "profile.public:reorder-artworks": {
    title: "작품 순서는 여기서",
    body: "[순서 변경]을 누르면 활성 탭 안에서 작품을 드래그해 배치할 수 있어요. 방문자는 정확히 이 순서로 보게 돼요. 탭이 섞여 보이면 내 스튜디오에서 새 탭으로 분리해도 좋아요.",
  },
  "profile.public:exhibitions": {
    title: "전시 정렬과 순서 변경",
    body: "등록순/시작일순으로 빠르게 바꾸거나, [순서 변경]으로 직접 정한 순서를 저장할 수 있어요. 단순 정렬은 잠깐 보는 용도이고, 직접 정렬은 프로필에 저장돼요.",
  },
  "profile.public:studio-link": {
    title: "탭 관리는 내 스튜디오에서",
    body: "탭을 새로 만들거나, 이름을 바꾸거나, 공개 여부를 끄는 일은 내 스튜디오에서 해요. 이 버튼으로 언제든 바로 이동할 수 있어요.",
  },

  "upload.main:tabs": {
    title: "세 가지 업로드 방법",
    body: "지금 공유하려는 내용에 맞는 경로를 골라주세요.",
  },
  "upload.main:single": {
    title: "개별 업로드",
    body: "작품 한 점을 자세히 올리는 경로예요. 제목·사이즈·매체·가격·이야기를 한 번에 기록할 수 있어요.",
  },
  "upload.main:bulk": {
    title: "일괄 업로드",
    body: "여러 점을 한 번에 올리는 경로예요. 보유 작품이나 인벤토리를 한꺼번에 가져올 때 좋아요.",
  },
  "upload.main:exhibition": {
    title: "전시 게시물 만들기",
    body: "전시 전체를 한 페이지에 담아 발행하는 경로예요. 참여 작가·작품·일정·장소가 함께 묶여요.",
  },
  "upload.main:intent": {
    title: "이 작품과 나의 관계는요",
    body: "직접 만든 작품인지, 소유 중인지, 인벤토리에 보관 중인지, 큐레이션 중인지 알려주세요. 알맞은 기록이 자동으로 만들어져요.",
  },

  "exhibition.create:purpose": {
    title: "공유할 수 있는 전시 게시물",
    body: "이미 진행했거나 진행 중, 또는 예정된 전시를 소개하는 게시물이에요. 새 전시를 기획하는 화면은 아니에요.",
  },
  "exhibition.create:dates": {
    title: "언제 열리나요",
    body: "시작일과 종료일을 남기면 컬렉터·큐레이터·방문자가 일정을 알 수 있어요.",
  },
  "exhibition.create:status": {
    title: "전시 상태",
    body: "예정·진행 중·종료 중에서 고르면, 게시물 노출 방식도 자동으로 맞춰져요.",
  },
  "exhibition.create:curator": {
    title: "큐레이터와 호스트",
    body: "전시를 만든 큐레이터와 주최자를 남겨보세요. Theo 안의 프로필을 바로 연결할 수 있어요.",
  },

  "people.main:search": {
    title: "사람 검색",
    body: "이름이나 @username, 키워드로 작가·컬렉터·큐레이터·갤러리를 찾을 수 있어요.",
  },
  "people.main:lanes": {
    title: "추천 모드",
    body: "내 네트워크가 아는 사람·내 취향과 맞는 사람·새로 만나볼 만한 사람을 따로 보여줘요.",
  },
  "people.main:roles": {
    title: "역할로 좁히기",
    body: "작가·컬렉터·큐레이터·갤러리 중 특정 역할만 남기고 싶을 때 써보세요.",
  },
  "people.main:card": {
    title: "연결 액션",
    body: "팔로우로 가까이 두거나, 첫 인사가 중요한 자리에는 짧은 메시지로 먼저 말을 걸 수 있어요.",
  },

  "delegation.main:what": {
    title: "계정 운영만 함께, 정체성은 그대로",
    body: "신뢰할 수 있는 분에게 계정 운영을 함께 맡길 수 있어요. 로그인·결제·계정 삭제처럼 정체성 영역은 절대 공유되지 않고, 업로드·전시·문의 같은 실무만 나눌 수 있어요.",
  },
  "delegation.main:wizard": {
    title: "새 위임 만들기",
    body: "[새 위임 만들기]를 누르면 4단계 안내가 시작돼요. 범위(계정 전체/특정 전시) → 사람 → 권한 묶음 → 검토 순으로 진행되고, 마지막 단계에서 어떤 정보가 공유되고 어떤 정보는 공유되지 않는지 한 번 더 보여드려요.",
  },
  "delegation.main:received": {
    title: "내게 온 초대",
    body: "다른 분이 보낸 위임 요청이 대기·수락·종료 탭으로 정리돼 도착해요. [권한 보기]로 어떤 권한이 공유되는지 미리 확인하고, 정말 맡을 것만 수락해 주세요.",
  },
  "delegation.main:sent": {
    title: "내가 만든 위임",
    body: "내가 맡긴 모든 위임은 이곳에서 카드로 보이고, [권한 보기]에서 활동 기록까지 확인하거나 언제든 [위임 해제]로 회수할 수 있어요. 숨겨진 연결은 없어요.",
  },
  "delegation.main:acting": {
    title: "다른 계정으로 작업 중일 때",
    body: "위임을 수락한 후 다른 분의 계정으로 작업하실 때는 화면 상단에 노란 띠가 항상 떠 있어요. [권한 보기]로 가능한 작업을 다시 확인할 수 있고, [내 계정으로 돌아가기]로 즉시 본인 계정으로 돌아올 수 있어요.",
  },
  "delegation.main:account-switcher": {
    title: "아바타에서 계정 전환",
    body: "본인 계정은 언제나 한 번의 클릭으로 돌아올 수 있어요. 우상단 아바타 메뉴를 열면 본인 계정과 위임받은 계정 사이를 자유롭게 오갈 수 있고, 지금 어느 페르소나로 작업 중인지 한눈에 표시돼요.",
  },
  "delegation.main:acting-as-chip": {
    title: "각 폼의 페르소나 표시",
    body: "다른 분의 계정으로 업로드·편집·답장을 하실 때, 폼 상단에 '○○ 명의로 게시 중 · 운영자: 본인' 칩이 떠요. 저장 직전 어느 페르소나로 작업 중인지 매번 확인할 수 있는 마지막 안전망이에요.",
  },

  "network.main:tabs": {
    title: "팔로워 · 팔로잉",
    body: "나를 팔로우하는 사람과 내가 팔로우하는 사람을 오가며 볼 수 있어요. 그래프의 두 면이에요.",
  },
  "network.main:search": {
    title: "검색 · 정렬",
    body: "이름으로 좁히거나 최근 순으로 정렬해서 최근에 연결된 사람을 쉽게 찾을 수 있어요.",
  },
  "network.main:list": {
    title: "내 관계 그래프",
    body: "각 줄이 살아있는 연결이에요. 맞팔하거나 스튜디오를 보거나 짧은 메시지로 인사를 건네보세요.",
  },
};

export function tourKoStepKey(tourId: string, stepId: string): string {
  return `${tourId}:${stepId}`;
}
