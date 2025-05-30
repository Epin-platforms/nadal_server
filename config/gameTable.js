import fs from 'fs/promises';
let singleKdkRules = {}; // 1. 초기 빈 객체로 선언
let doubleKdkRules = {};

export async function loadKDKSingleRules() {
  const data = await fs.readFile('./json/kdk_rules_single.json', 'utf-8');
  singleKdkRules = JSON.parse(data); // 2. json을 읽어서 파싱 후 저장
}

export async function loadKDKDoubleRules() {
    const data = await fs.readFile('./json/kdk_rules_double.json', 'utf-8');
    doubleKdkRules = JSON.parse(data); // 2. json을 읽어서 파싱 후 저장
}

export { singleKdkRules , doubleKdkRules }; // 호출 전이면 빈 객체
