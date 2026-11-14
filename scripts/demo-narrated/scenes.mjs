// 대본과 화면 조작이에요. 사람이 읽는 판은 make.mjs script로 만들어요.
// say가 있으면 음성은 say를 읽고 자막은 t를 써요.
export const VOICE = { provider: 'edge', id: 'ko-KR-SunHiNeural', rate: '+5%' };
export const LEAD = 0.4, GAP = 0.5, TAIL = 0.9;

async function expand(h, title) {
  const head = h.page.locator('button[aria-expanded]', { has: h.page.getByText(title, { exact: true }) });
  await h.scrollTo(head);
  await h.tap(head);
  await h.expect(head).toHaveAttribute('aria-expanded', 'true');
  await h.scrollTo(head.locator('..'));
}

const board = (h) => h.page.getByRole('region', { name: '리더보드' });
const result = (h) => h.page.getByRole('region', { name: '시뮬레이션 결과' }).last();

export const SCENES = [
  {
    id: 'intro', title: '가즈아', note: '관심종목 비교 · 매매 규칙 시뮬레이션',
    lines: [
      { t: '가즈아는 관심 있는 종목을 한 화면에서 비교하고, 내 매매 규칙을 과거 데이터로 시험해 보는 앱이에요.' },
      { t: '휴대폰 브라우저로 열고 홈 화면에 추가하면 앱처럼 쓸 수 있어요.', do: async (h) => {
        await h.point(h.page.getByRole('heading', { level: 1, name: '가즈아' }));
      } },
      { t: '비교 차트부터 시뮬레이션, 선정 기준 검증, 내 성과까지 차례로 둘러볼게요.', do: async (h) => {
        await h.point(h.page.getByRole('button', { name: '내 API로 시작' }));
      } },
    ],
  },
  {
    id: 'demo', title: '데모로 둘러보기', note: '가상 시세로 모든 화면을 써 봐요',
    lines: [
      { t: '증권사 키가 없어도 괜찮아요.', do: async (h) => { await h.point(h.page.getByRole('button', { name: '데모로 둘러보기' })); } },
      { t: '첫 화면에서 데모로 둘러보기를 누르면, 가상 시세로 모든 화면을 써 볼 수 있어요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '데모로 둘러보기' }));
        await h.expect(h.page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
      } },
      { t: '오늘은 이 데모로 하나씩 같이 눌러 볼게요.' },
    ],
  },
  {
    id: 'compare', title: '비교 차트', note: '여러 종목을 한 차트에서',
    lines: [
      { t: '먼저 예시 그룹을 불러올게요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '예시 그룹 불러오기' }));
        await h.expect(board(h).getByRole('listitem')).toHaveCount(4);
      } },
      { t: '그룹에 담은 종목들이 한 차트에 겹쳐 그려져요.', do: async (h) => { await h.wait(800); } },
      { t: '선은 모두 같은 기준일 종가를 0으로 맞춰서, 어느 종목이 더 올랐는지 한눈에 보여요.' },
      { t: '기간은 일, 주, 월, 년으로 바꿀 수 있어요.', do: async (h) => {
        for (const name of ['주', '월', '년']) {
          const radio = h.page.getByRole('radio', { name, exact: true });
          await h.tap(radio);
          await h.expect(radio).toBeChecked();
          await h.wait(500);
        }
      } },
      { t: '비교 기준도 바꿀 수 있어요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: /^등락률/ }));
        await h.expect(h.page.getByRole('dialog', { name: '비교 지표' })).toBeVisible();
      } },
      { t: '이번엔 고점 대비 하락률을 골라 볼게요.', do: async (h) => {
        const sheet = h.page.getByRole('dialog', { name: '비교 지표' });
        await h.tap(sheet.getByRole('button', { name: /^고점 대비 하락률/ }));
        await h.expect(sheet).toBeHidden();
      } },
      { t: '아래 순위표도 그 기준으로 다시 줄을 서요.', do: async (h) => {
        await h.scrollTo(board(h));
        // 값 순이 기본이라, 내 순서로 바꿨다가 값 순으로 되돌려 줄이 다시 서는 모습을 보여요.
        for (const name of ['내 순서', '값 순']) {
          const sort = board(h).getByRole('button', { name, exact: true });
          await h.tap(sort);
          await h.expect(sort).toHaveAttribute('aria-pressed', 'true');
          await h.wait(500);
        }
      } },
      { t: '이렇게 보면 고점에서 가장 덜 빠진 종목이 어디인지 바로 알 수 있어요.' },
    ],
  },
  {
    id: 'groups', title: '종목 추가 · 그룹', note: '이름·초성으로 찾아 담아요',
    lines: [
      { t: '종목을 더 담아 볼게요.', do: async (h) => {
        const add = board(h).getByRole('button', { name: '＋ 종목 추가' });
        await h.scrollTo(add);
        await h.tap(add);
        await h.expect(h.page.getByRole('dialog', { name: '종목 추가' })).toBeVisible();
      } },
      { t: '이름은 물론, 초성만 쳐도 찾아져요.', do: async (h) => {
        const sheet = h.page.getByRole('dialog', { name: '종목 추가' });
        await h.type(sheet.getByRole('searchbox', { name: '종목 검색' }), 'ㅅㅅㅈㄱ');
        await h.expect(sheet.getByRole('button', { name: '삼성전기 추가', exact: true })).toBeVisible();
      } },
      { t: '삼성전기를 눌러 담고, 완료를 눌러요.', do: async (h) => {
        const sheet = h.page.getByRole('dialog', { name: '종목 추가' });
        await h.tap(sheet.getByRole('button', { name: '삼성전기 추가', exact: true }));
        await h.expect(sheet).toContainText('5/10');
        await h.tap(sheet.getByRole('button', { name: '완료', exact: true }));
        await h.expect(sheet).toBeHidden();
      } },
      { t: '한 그룹에는 열 종목까지 담을 수 있어요.' },
      { t: '그룹은 여러 개 만들 수 있어요.', do: async (h) => {
        const add = h.page.getByRole('button', { name: '새 그룹', exact: true });
        await h.scrollTo(add);
        await h.tap(add);
        await h.expect(h.page.getByRole('tab', { name: '새 그룹 2', exact: true })).toHaveAttribute('aria-selected', 'true');
      } },
      { t: '그룹 관리에서 이름과 순서를 바꿔요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '그룹 관리', exact: true }));
        const sheet = h.page.getByRole('dialog', { name: '그룹 관리' });
        await h.tap(sheet.getByRole('button', { name: '새 그룹 2 이름 바꾸기', exact: true }));
        const name = sheet.getByRole('textbox', { name: '그룹 이름' });
        await name.fill('');
        await h.type(name, '내 반도체');
        await name.press('Enter');
        await h.expect(sheet.getByRole('button', { name: '내 반도체 이름 바꾸기', exact: true })).toBeVisible();
        await h.tap(sheet.getByRole('button', { name: '내 반도체 위로', exact: true }));
      } },
      { t: '조건으로 종목을 골라 새 그룹을 만드는 것도 여기서 해요.', do: async (h) => {
        const sheet = h.page.getByRole('dialog', { name: '그룹 관리' });
        await h.scrollTo(sheet.getByRole('button', { name: '조건으로 골라 새 그룹 만들기', exact: true }));
        await h.wait(600);
        // GroupSheet가 쓰는 공용 Sheet의 기본 닫기 이름이에요.
        await h.tap(sheet.getByRole('button', { name: '닫기', exact: true }));
        await h.expect(sheet).toBeHidden();
        // 순서를 바꿔 빈 「내 반도체」가 앞에 오므로, 종목이 든 예시 그룹을 이름으로 골라요.
        const group = h.page.getByRole('tablist', { name: '관심 그룹' }).getByRole('tab', { name: '내 관심', exact: true });
        await h.tap(group);
        await h.expect(group).toHaveAttribute('aria-selected', 'true');
      } },
    ],
  },
  {
    id: 'simulate', title: '매매 규칙 시뮬레이션', note: '내 규칙을 과거 일봉에 적용해요',
    lines: [
      { t: '이제 시뮬레이션 메뉴로 가 볼게요.', do: async (h) => {
        await h.nav('시뮬레이션');
        await h.expect(h.page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
      } },
      { t: '새 전략을 누르면 자주 쓰는 틀이 나와요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '＋ 새 전략' }));
        await h.expect(h.page.getByRole('button', { name: /하락 후 반등/ })).toBeVisible();
      } },
      { t: '하락 후 반등을 골라 볼게요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: /하락 후 반등/ }));
        await h.expect(h.page.getByRole('button', { name: '시뮬레이션 실행' })).toBeVisible();
      } },
      { t: '이 틀은 고점에서 떨어졌다가 다시 오를 때 사고, 15% 오르면 팔고 5% 내리면 손절해요.' },
      { t: '언제 살지 매수 조건을 칸마다 정해요.', do: async (h) => { await expand(h, '매수 조건'); } },
      { t: '팔 때의 조건도 같은 방식으로 정해요.', do: async (h) => { await expand(h, '매도'); } },
      { t: '시뮬레이션 실행을 누르면 과거 일봉에 규칙을 그대로 적용해요.', do: async (h) => {
        const run = h.page.getByRole('button', { name: '시뮬레이션 실행' });
        await h.scrollTo(run);
        await h.tap(run);
        await h.expect(result(h).getByText('총수익률', { exact: true })).toBeVisible({ timeout: 30_000 });
      } },
      { t: '총수익률과 최대 낙폭, 승률을 보여 주고, 총수익률은 그냥 보유했을 때와 견줘 줘요.', do: async (h) => { await h.scrollTo(result(h)); } },
      { t: '같은 종목을 사서 들고만 있었을 때, 그리고 코스피와 KODEX 200도 함께 비교해요.' },
      { t: '재생을 누르면 그날그날 사고판 기록을 다시 보여 줘요.', do: async (h) => {
        const bar = result(h).getByRole('group', { name: '재생' });
        await h.scrollTo(bar);
        await h.tap(bar.getByRole('button', { name: '재생', exact: true }));
        await h.expect(bar.getByRole('button', { name: '일시정지' })).toBeVisible();
      } },
      { t: '배속을 높이면 몇 년 치 매매도 금방 훑어볼 수 있어요.', do: async (h) => {
        const fast = result(h).getByRole('radiogroup', { name: '배속' }).getByRole('radio', { name: '16×', exact: true });
        await h.tap(fast);
        await h.expect(fast).toBeChecked();
      } },
      { t: '아래에는 그날의 자산과 현금, 들고 있는 종목이 함께 나와요.', do: async (h) => {
        await h.scrollTo(result(h).getByRole('region', { name: '그날 상황' }));
        await h.wait(1500);
        await h.tap(result(h).getByRole('button', { name: '일시정지' }));
      } },
    ],
  },
  {
    id: 'criteria', title: '선정 기준 검증', note: '그때 이 기준으로 골랐다면',
    lines: [
      { t: '선정 기준 검증은 시장 전체 데이터가 있어야 해서, 설정에서 데이터 파일을 먼저 가져와요.', do: async (h) => {
        await h.nav('설정');
        await h.expect(h.page.getByRole('heading', { name: '데이터 공급자' })).toBeVisible();
        await h.chooseFile(h.page.getByRole('button', { name: '시장 데이터 가져오기', exact: true }), h.fixture);
        await h.expect(h.page.getByText(/30종목/)).toBeVisible({ timeout: 30_000 });
      } },
      { t: '다시 시뮬레이션으로 와서 선정 기준 탭을 눌러요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '비교로 돌아가기' }));
        await h.nav('시뮬레이션');
        const tab = h.page.getByRole('tab', { name: '선정 기준', exact: true });
        await h.tap(tab);
        await h.expect(tab).toHaveAttribute('aria-selected', 'true');
      } },
      { t: '새 기준을 만들고, 고를 조건을 켜요.', do: async (h) => {
        await h.tap(h.page.getByRole('button', { name: '＋ 새 기준' }).first());
        const marketCap = h.page.getByRole('switch', { name: '시가총액 사용', exact: true });
        await h.scrollTo(marketCap);
        await h.tap(marketCap);
        await h.expect(marketCap).toBeChecked();
      } },
      { t: '시세뿐 아니라 환율, 유가, 수급, 재무 조건도 섞어 쓸 수 있어요.' },
      { t: '몇 개를 고를지, 얼마나 자주 다시 고를지도 정해요.', do: async (h) => {
        await expand(h, '고를 개수·정렬');
        const count = h.page.getByRole('textbox', { name: '고를 개수', exact: true });
        await count.fill('');
        await h.type(count, '10');
        await expand(h, '재선정·기간');
        const monthly = h.page.getByRole('radio', { name: '매월', exact: true });
        await h.tap(monthly);
        await h.expect(monthly).toBeChecked();
      } },
      { t: '오늘 기준으로 몇 종목이 통과하는지 바로 미리 보여 줘요.', do: async (h) => {
        const preview = h.page.getByRole('region', { name: '오늘 기준 미리 보기', exact: true });
        await h.expect(preview.getByRole('status')).toHaveText(/통과 \d+개 · 상위 \d+개/, { timeout: 30_000 });
        await h.scrollTo(preview);
      } },
      { t: '검증 실행을 누르면 과거 시점마다 이 기준으로 골랐다면 어땠을지 계산해요.', do: async (h) => {
        const run = h.page.getByRole('button', { name: '검증 실행', exact: true });
        await h.scrollTo(run);
        await h.tap(run);
        await h.expect(h.page.getByRole('heading', { name: '오늘 기준 선별' })).toBeVisible({ timeout: 60_000 });
      } },
      { t: '결과는 요약과 시장별 보기로 나눠 볼 수 있어요.', do: async (h) => {
        await h.scrollTo(h.page.getByRole('heading', { name: '요약', exact: true }));
        await h.wait(800);
        await h.scrollTo(h.page.getByRole('region', { name: '시장별 보기', exact: true }));
      } },
      { t: '결과가 마음에 들지 않으면 조건을 고쳐서 다시 돌려 보면 돼요.' },
    ],
  },
  {
    id: 'performance', title: '내 성과', note: '내 주문 vs 같은 날 지수·ETF',
    lines: [
      { t: '내 성과는 실제로 체결된 주문을 지수와 비교하는 메뉴예요.', do: async (h) => {
        await h.nav('내 성과');
        await h.expect(h.page.getByText('데모 계좌예요')).toBeVisible();
      } },
      { t: '데모에서는 가상 계좌로 보여 줘요.' },
      { t: '같은 날 같은 금액으로 ETF를 샀다면 어땠을지 나란히 놓아요.', do: async (h) => {
        await h.select(h.page.getByLabel('벤치마크'), '069500');
        await h.expect(h.page.getByRole('region', { name: '요약' }).getByText('KODEX 200 연수익률')).toBeVisible();
      } },
      { t: '내 연수익률은 돈이 들어가고 나온 날짜까지 따지는 IRR로 계산해요.' },
      { t: '기간을 올해로 좁히고, 표로도 볼 수 있어요.', do: async (h) => {
        await h.select(h.page.getByLabel('기간'), '2026');
        const table = h.page.getByRole('button', { name: '표 보기', exact: true });
        await h.scrollTo(table);
        await h.tap(table);
        await h.scrollTo(h.page.getByRole('table', { name: '날짜별 평가금액과 회수액' }));
      } },
      { t: '평가금액에 이미 팔아서 돌려받은 돈을 더해, 실제로 얼마나 벌었는지 보여 줘요.' },
      { t: '종목을 누르면 체결 내역이 펼쳐져요.', do: async (h) => {
        const row = h.page.getByRole('button', { name: /삼성전자/ });
        await h.scrollTo(row);
        await h.tap(row);
        await h.expect(row).toHaveAttribute('aria-expanded', 'true');
        await h.scrollTo(h.page.getByRole('table', { name: '삼성전자 체결 목록' }));
      } },
    ],
  },
  {
    id: 'settings', title: '설정', note: '증권사 연결 · 화면 꾸미기',
    lines: [
      { t: '마지막으로 설정이에요.', do: async (h) => {
        await h.nav('설정');
        await h.scrollTo(h.page.getByRole('radiogroup', { name: '데이터 공급자', exact: true }));
      } },
      { t: '실제 시세를 보려면 한국투자증권이나 토스증권을 고르고 키를 넣어요.', do: async (h) => {
        await h.tap(h.page.getByRole('radio', { name: '한국투자증권 (KIS)', exact: true }));
        const key = h.page.getByLabel('App Key', { exact: true });
        await h.scrollTo(key);
        await h.expect(key).toHaveValue('');
      } },
      { t: '연결이 안 되면 진단 시작으로 어디에서 막혔는지 확인할 수 있어요.', do: async (h) => {
        await h.scrollTo(h.page.getByRole('button', { name: '진단 시작', exact: true }));
      } },
      { t: '키는 암호로 잠가 둘 수도 있어요.', do: async (h) => { await h.scrollTo(h.page.getByRole('switch', { name: '키를 암호로 잠그기', exact: true })); } },
      { t: '표시에서는 밝기와 색 테마를 고를 수 있어요.', do: async (h) => {
        await h.scrollTo(h.page.getByRole('heading', { name: '표시', exact: true }));
        await h.tap(h.page.getByRole('radiogroup', { name: '테마', exact: true }).getByRole('radio', { name: '다크', exact: true }));
      } },
      { t: '취향에 맞는 색으로 바꿔 보세요.', do: async (h) => {
        const palette = h.page.getByRole('radiogroup', { name: '색 테마', exact: true });
        await h.tap(palette.getByRole('radio', { name: '숲', exact: true }));
        await h.wait(600);
        await h.tap(palette.getByRole('radio', { name: '장미', exact: true }));
      } },
    ],
  },
  {
    id: 'outro', title: '마무리', note: 'gazua.sch0718.dev',
    lines: [
      { t: '가즈아는 무료로 열어 두었어요.', do: async (h) => { await h.tap(h.page.getByRole('button', { name: '비교로 돌아가기' })); } },
      { t: '관심 종목을 비교하고, 내 규칙을 미리 시험해 보는 데 써 보세요.' },
      { t: '주소는 gazua.sch0718.dev예요.', say: '주소는 가즈아 점 에스씨에이치 공칠일팔 점 데브예요.' },
      { t: '설명란에도 주소를 적어 둘게요.' },
      { t: '화면의 시세는 모두 가상 데이터이고, 투자 조언이 아니에요.' },
      { t: '봐 주셔서 고마워요.' },
    ],
  },
];
