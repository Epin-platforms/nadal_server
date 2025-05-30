
// 사용자 레벨 배치
export async function createUserLevel(table, connection) {
    try {
      const isArrangement = await arrangeMentCheck(table.uid, connection);
      let basicUnit = isArrangement ? 0.003 : 0.001;
      let weight = isArrangement ? 0.0009 : 0.0003;
  
      const safeFinalScore = table.finalScore || 1;
      const diffRatio = table.scoreDiff / safeFinalScore;
  
      const ratio = diffRatio < 0.35 ? 1 :
                    diffRatio < 0.7 ? 2 :
                    diffRatio < 0.9 ? 3 : 4;
  
      let levelFluctuations = 0;
  
      if (table.scoreDiff >= 0) {
        levelFluctuations = calculateWinFluctuation(table.levelDiff, basicUnit);
  
        if (isArrangement && table.levelDiff < -1 && ratio < 4) {
          levelFluctuations -= (4 - ratio) * weight;
        } else {
          levelFluctuations += ratio * weight;
        }
      } else {
        levelFluctuations = calculateLoseFluctuation(table.levelDiff, basicUnit);
        levelFluctuations -= ratio * weight;
      }
  
      let newLevel = table.originLevel + levelFluctuations;
  
      // 범위 제한: 1.0 ~ 10.0
      newLevel = Math.min(10, Math.max(1, newLevel));
  
      // 예외 처리: 최댓값이나 최솟값에 도달했으면 변화 없음
      if ((table.originLevel >= 10 && levelFluctuations > 0) || (table.originLevel <= 1 && levelFluctuations < 0)) {
        levelFluctuations = 0;
        newLevel = table.originLevel;
      }
  
      // 기록 저장
      const insertQuery = `
        INSERT INTO userLevel (uid, scheduleId, tableId, fluctuation, original)
        VALUES (?, ?, ?, ?, ?);
      `;

      await connection.query(insertQuery, [table.uid, table.scheduleId, table.tableId, levelFluctuations, table.originLevel]);
  
      // 사용자 레벨 업데이트
      const updateQuery = `
        UPDATE user
        SET level = ?
        WHERE uid = ?;
      `;

      await connection.query(updateQuery, [newLevel, table.uid]);
  
      console.log(`레벨 저장 성공: ${table.uid} → ${newLevel}`);
      return { ...table, fluctuation: levelFluctuations, newLevel };
  
    } catch (err) {
      console.error(`${table.uid} 레벨 측정 실패`, err);
      throw err;
    }
  }
  
  
  // 승리 시 레벨 변화 계산 함수
  function calculateWinFluctuation(levelDiff, basicUnit) {
    if (levelDiff < -2) return basicUnit * 0;
    if (levelDiff < 1) return basicUnit * 1;
    if (levelDiff === 1) return basicUnit * 2;
    if (levelDiff === 2) return basicUnit * 3;
    if (levelDiff === 3) return basicUnit * 4;
    if (levelDiff === 4) return basicUnit * 5;
    return basicUnit * 10;
  }
  
  // 패배 시 레벨 변화 계산 함수
  function calculateLoseFluctuation(levelDiff, basicUnit) {
    if (levelDiff < -2) return basicUnit * -10;
    if (levelDiff === -2) return basicUnit * -5;
    if (levelDiff === -1) return basicUnit * -3;
    if (levelDiff === 0) return basicUnit * -2;
    if (levelDiff < 4) return basicUnit * -1;
    return basicUnit * 0;
  }
  
  // 배치 판정 함수
  async function arrangeMentCheck(uid, connection) {

    const query = `
      SELECT COUNT(*) as count FROM userLevel
      WHERE uid = ?;
    `;
    const [results] = await connection.query(query, [uid]);
    return results[0].count <= 10;
  }
  

//게임 랭킹 및 점수 업데이트
export async function updateScheduleMemberInGame(scheduleId, memberRanking, connection){
  const q = `
    UPDATE scheduleMember
    SET score = ?, winPoint = ?, ranking = ?
    WHERE scheduleId = ? AND uid = ?;
  `;

  for (const member of memberRanking) {
    await connection.query(q, [member.score, member.winPoint, member.ranking, scheduleId, member.uid]);
  }
}