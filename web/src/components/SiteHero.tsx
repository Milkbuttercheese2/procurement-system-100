// 메인 상단 히어로. 스타일은 globals.css의 .law-process-* 계열을 재사용한다
// (원래 LawToProcessHero용으로 작성됐으나 그 컴포넌트는 현재 미사용).

export default function SiteHero({
  institutionCount,
  asOfDate,
}: {
  institutionCount: number;
  asOfDate: string;
}) {
  return (
    <section className="law-process-hero" aria-labelledby="site-hero-title">
      <div className="law-process-hero-inner">
        <header className="law-process-heading">
          <p className="law-process-kicker">
            <span aria-hidden="true" />
            법령에서 업무로
          </p>
          <h1 id="site-hero-title">그 많던 조달은 어떻게 했을까?</h1>
          <p className="law-process-lead">
            어느 날 갑자기 맡게 되셨더라도 괜찮습니다. 다들 그렇게 시작했으니까요.
            <br />
            법령에 흩어진 절차를 담당자·서류·기한이 보이는 한 장으로 정리하고, 근거는 조문까지 대조했습니다.
          </p>
          <p className="site-hero-meta">
            제도 {institutionCount}개 · 국가법령정보센터 조문 대조 완료 · 기준일 {asOfDate}
          </p>
        </header>
      </div>
    </section>
  );
}
