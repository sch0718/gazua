// 설정 → 정보 화면에 쓰는 링크.
// Ko-fi 페이지가 생기면 KOFI_URL에 주소(https://ko-fi.com/<아이디>)를 넣는다. 비어 있으면 후원 줄이 숨는다.
export const KOFI_URL = '';
export const REPO_URL = 'https://github.com/sch0718/gazua';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
// prebuild(scripts/build-notices.mjs)가 만든다. 개발 서버에서는 `pnpm notices`를 한 번 돌려야 열린다.
export const NOTICES_URL = `${import.meta.env.BASE_URL}licenses.txt`;
