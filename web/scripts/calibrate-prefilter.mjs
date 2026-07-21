// 프리필터 하한값 보정. route.ts의 PREFILTER_FLOOR 를 정하는 근거다.
// 조달 질문은 통과하고 무관한 질문은 걸러지는 지점을 실측으로 찾는다.
import fs from "node:fs";
const idx=JSON.parse(fs.readFileSync("data/routing-index.json","utf8"));
const bg=s=>{const o=new Set();const t=s.replace(/\s/g,"");for(let i=0;i<t.length-1;i++)o.add(t.slice(i,i+2));return o;};
const BLOB=new Map(idx.map(e=>[e.slug,bg(`${e.name}${e.oneLiner}${e.applicability}${e.category}`)]));
const score=q=>{const Q=bg(q);if(!Q.size)return 0;
  return Math.max(...idx.map(e=>{const B=BLOB.get(e.slug);let n=0;for(const g of Q)if(B.has(g))n++;return n/Q.size;}));};
const IN=["낙찰자가 계약을 안 하겠다고 버팁니다","납품기한을 넘겼는데 어떻게 되나요","물품을 받았는데 규격이 다릅니다",
 "사무실 의자 30개 사야 하는데요","업체가 갑자기 못 하겠다고 합니다","작년에 계약한 공사인데 자재값이 너무 올랐대요",
 "우수제품 지정이 되는게 좋을까 혁신시제품이 되는게 좋을까","공동수급체로 들어갔는데 한 업체가 부도났어요",
 "입찰 참가하려면 뭐부터 해야 하나요","계약 상대가 하도급 대금을 안 준대요",
 // 짧거나 약칭이 섞인 질의 — 하한에 걸려 차단되기 쉬운 쪽이다.
 "선금을 주고 싶은데 절차가 어떻게 되나요","턴키로 발주하려는데","PQ 심사 통과해야 하나요",
 "종심제 준비중입니다","국계법 지체상금","MAS 2단계경쟁","하자가 발견됐는데 업체가 안 고쳐줍니다",
 "입찰이 두 번이나 유찰됐습니다","긴급한 재난 상황인데 입찰할 시간이 없습니다","계약을 해지하고 싶은데 가능한가요"];
const OUT=["오늘 날씨 어때","파이썬으로 웹크롤러 만드는 법","점심 뭐 먹지","주식 지금 사도 될까",
 "이혼 소송 절차 알려줘","고양이가 밥을 안 먹어요","넷플릭스 추천해줘","영어 공부 어떻게 해"];
const si=IN.map(score),so=OUT.map(score);
const f=a=>a.map(x=>x.toFixed(3)).join(" ");
console.log("조달 질문   min",Math.min(...si).toFixed(3)," :",f(si));
console.log("무관 질문   max",Math.max(...so).toFixed(3)," :",f(so));
console.log("\n임계값별 (조달 통과 / 무관 차단):");
for(const t of [0.02,0.05,0.08,0.10,0.12,0.15]){
  console.log(`  ${t.toFixed(2)}  ${si.filter(x=>x>=t).length}/${si.length}  ${so.filter(x=>x<t).length}/${so.length}`);
}
