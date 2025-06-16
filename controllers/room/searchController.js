import pool from '../../config/database.js';

// 입력 검증 및 정제 함수 (단순화)
function sanitizeSearchText(text) {
    if (!text || typeof text !== 'string') return '';
    
    // 특수문자 이스케이프 및 길이 제한 (LIKE 쿼리용 특수문자만)
    return text
        .trim()
        .substring(0, 100) // 최대 100자 제한
        .replace(/[%_\\]/g, '\\$&'); // LIKE 쿼리 특수문자만 이스케이프
}

// 자동 완성 방 검색
export async function autoTextSearchRooms(req, res) {
    const connection = await pool.getConnection();
    try {
        const rawText = req.query.text;
        const isOpen = Number(req.query.isOpen) === 1;
        
        console.log('자동완성 검색 요청:', { rawText, isOpen });
        
        // 입력 검증
        if (!rawText || rawText.length < 1) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }
        
        const text = sanitizeSearchText(rawText);
        if (!text) {
            return res.status(400).json({ error: 'Invalid search text' });
        }
        
        console.log('정제된 검색어:', text);
        
        await connection.beginTransaction();
        
        const searchPattern = `%${text}%`;
        
        const q = `
            SELECT roomName, tag, description
            FROM room
            WHERE isOpen = ? 
            AND (
                roomName LIKE ? OR 
                tag LIKE ? OR 
                description LIKE ?
            )
            ORDER BY 
                CASE 
                    WHEN roomName LIKE ? THEN 1
                    WHEN tag LIKE ? THEN 2
                    ELSE 3
                END,
                LENGTH(roomName) ASC
            LIMIT 13
        `;
        
        const params = [
            isOpen, 
            searchPattern, searchPattern, searchPattern,
            searchPattern, searchPattern
        ];
        
        const [rows] = await connection.query(q, params);
        
        console.log('자동완성 결과 개수:', rows.length);
        
        const result = rows.map(row => ({
            roomName: row.roomName || '',
            tagSnippet: extractContext(text, row.tag, 'tag'),
            descriptionSnippet: extractContext(text, row.description, 'description'),
        })).filter(item => 
            item.roomName || 
            (item.tagSnippet && item.tagSnippet.length > 0) || 
            item.descriptionSnippet
        );
        
        await connection.commit();
        res.json(result);
        
    } catch (error) {
        await connection.rollback();
        console.error('자동 완성 쿼리 오류:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
}

// 안전한 컨텍스트 추출 함수
function extractContext(keyword, text, type = 'default') {
    if (!text || !keyword || typeof text !== 'string' || typeof keyword !== 'string') {
        return type === 'tag' ? [] : null;
    }
    
    try {
        const safeKeyword = keyword.toLowerCase();
        const safeText = text.toLowerCase();
        
        if (type === 'tag') {
            if (!safeText.includes('#')) {
                return safeText.includes(safeKeyword) ? [text] : [];
            }
            
            return text
                .split('#')
                .map(t => t.trim())
                .filter(t => t && t.toLowerCase().includes(safeKeyword))
                .map(t => `#${t}`)
                .slice(0, 5); // 최대 5개 제한
        }
        
        if (type === 'description') {
            const keywordIndex = safeText.indexOf(safeKeyword);
            if (keywordIndex === -1) return null;
            
            const start = Math.max(0, keywordIndex - 20);
            const end = Math.min(text.length, keywordIndex + safeKeyword.length + 20);
            
            let result = text.substring(start, end).trim();
            if (start > 0) result = '...' + result;
            if (end < text.length) result = result + '...';
            
            return result;
        }
        
        return null;
    } catch (error) {
        console.error('Context extraction error:', error);
        return type === 'tag' ? [] : null;
    }
}

// 추천 방 시스템
export async function recommendRooms(req, res) {
    const connection = await pool.getConnection();
    try {
        const { local } = req.query;
        const isOpen = Number(req.query.isOpen) === 1;
        const { uid } = req.user;
        
        // 입력 검증
        if (!local || typeof local !== 'string') {
            return res.status(400).json({ error: 'Local parameter is required' });
        }
        
        await connection.beginTransaction();
        
        const q = `
            SELECT 
                r.roomId,
                r.roomName, 
                r.roomImage, 
                r.tag, 
                r.local,
                COUNT(rm.uid) AS memberCount
            FROM room r
            LEFT JOIN roomMember rm ON rm.roomId = r.roomId
            WHERE r.local = ?
                AND r.isOpen = ?
                AND NOT EXISTS (
                    SELECT 1 FROM roomMember rm2
                    WHERE rm2.roomId = r.roomId AND rm2.uid = ?
                )
                AND NOT EXISTS (
                    SELECT 1 FROM blackList b
                    WHERE b.roomId = r.roomId AND b.uid = ?
                )
            GROUP BY r.roomId, r.roomName, r.roomImage, r.tag, r.local
            ORDER BY RAND()
            LIMIT 5
        `;
        
        const [rows] = await connection.query(q, [local, isOpen, uid, uid]);
        
        await connection.commit();
        res.json(rows);
        
    } catch (error) {
        await connection.rollback();
        console.error('추천 방 쿼리 오류:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
}

// 방 찾기
export async function searchRooms(req, res) {
    const connection = await pool.getConnection();
    try {
        const { uid } = req.user;
        const rawText = req.query.text;
        const isOpen = Number(req.query.isOpen) === 1;
        const offset = Math.max(0, Number(req.query.offset) || 0);
        
        console.log('방 검색 요청:', { rawText, isOpen, offset, uid });
        
        // 입력 검증
        if (!rawText || typeof rawText !== 'string') {
            return res.status(400).json({ error: 'Search text parameter is required' });
        }
        
        const text = sanitizeSearchText(rawText);
        if (!text) {
            return res.status(400).json({ error: 'Invalid search text' });
        }
        
        console.log('정제된 검색어:', text);
        
        await connection.beginTransaction();
        
        const searchPattern = `%${text}%`;
        
        const q = `
            SELECT 
                r.roomId,
                r.roomName,
                r.roomImage,
                r.tag,
                r.description,
                r.local,
                COUNT(rm2.roomId) AS memberCount
            FROM room r
            LEFT JOIN roomMember rm ON r.roomId = rm.roomId AND rm.uid = ?
            LEFT JOIN roomMember rm2 ON r.roomId = rm2.roomId
            WHERE rm.uid IS NULL
                AND r.isOpen = ?
                AND (
                    r.roomName LIKE ? OR
                    r.description LIKE ? OR
                    r.tag LIKE ?
                )
            GROUP BY r.roomId, r.roomName, r.roomImage, r.tag, r.description, r.local
            ORDER BY 
                CASE 
                    WHEN r.roomName LIKE ? THEN 1
                    WHEN r.tag LIKE ? THEN 2
                    ELSE 3
                END,
                r.createAt DESC
            LIMIT 10 OFFSET ?
        `;
        
        const params = [
            uid, isOpen, 
            searchPattern, searchPattern, searchPattern,
            searchPattern, searchPattern,
            offset
        ];
        
        console.log('SQL 쿼리 실행 중...');
        const [rows] = await connection.query(q, params);
        
        console.log('검색 결과:', rows.length, '개');
        
        await connection.commit();
        res.json(rows);
        
    } catch (error) {
        await connection.rollback();
        console.error('방 찾기 쿼리 오류:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
}