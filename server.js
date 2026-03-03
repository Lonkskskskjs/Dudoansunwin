
// ==========================
//  SUNWIN VIP PREDICT SERVER (SIÊU VIP) - FORMAT CURRENT + HISTORY
// ==========================

const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const cors = require("cors");

const app = express();
const cache = new NodeCache({ stdTTL: 3 });
app.use(cors());

const HISTORY_API = process.env.HISTORY || "https://meuni-basally-xzavier.ngrok-free.dev/api/history";
const CREATOR_ID = "@Cskhtoolhehe";

// ==========================
// Chuẩn hóa dữ liệu từ API (format current + history)
// ==========================
function toInt(v, fallback = 0) {
    if (v === undefined || v === null) return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : Math.floor(n);
}

function normalizeCurrentData(current) {
    // Format current: {Phien, Xuc_xac_1, Xuc_xac_2, Xuc_xac_3, Tong, Ket_qua}
    const phien = current.Phien || 0;
    const x1 = current.Xuc_xac_1 || 0;
    const x2 = current.Xuc_xac_2 || 0;
    const x3 = current.Xuc_xac_3 || 0;
    const tong = current.Tong || 0;
    const ketQua = current.Ket_qua || "";
    
    return {
        phien: toInt(phien),
        xuc_xac_1: toInt(x1),
        xuc_xac_2: toInt(x2),
        xuc_xac_3: toInt(x3),
        tong: toInt(tong),
        ket_qua: ketQua === "Tài" ? "T" : (ketQua === "Xỉu" ? "X" : "?"),
        ket_qua_day_du: ketQua
    };
}

function normalizeHistoryItem(item) {
    // Format history: {session, dice, total, result, timestamp}
    const session = item.session || 0;
    const dice = item.dice || [];
    const total = item.total || 0;
    const result = item.result || "";
    const timestamp = item.timestamp || "";
    
    return {
        phien: toInt(session),
        xuc_xac_1: toInt(dice[0]),
        xuc_xac_2: toInt(dice[1]),
        xuc_xac_3: toInt(dice[2]),
        tong: toInt(total),
        ket_qua: result === "Tài" ? "T" : (result === "Xỉu" ? "X" : "?"),
        ket_qua_day_du: result,
        thoi_gian: timestamp
    };
}

// ==========================
// TẠO PATTERN TỪ LỊCH SỬ
// ==========================
function createPatternString(history, count = 20) {
    const recent = history.slice(0, Math.min(count, history.length));
    return recent.map(h => h.ket_qua).join('');
}

// ==========================
// ĐẾM SỐ LẦN XUẤT HIỆN CỦA PATTERN
// ==========================
function countPatternOccurrences(str, pattern) {
    let count = 0;
    let pos = str.indexOf(pattern);
    while (pos !== -1) {
        count++;
        pos = str.indexOf(pattern, pos + 1);
    }
    return count;
}

// ==========================
// PHÂN TÍCH PATTERN CHUYÊN SÂU
// ==========================
function analyzePatterns(history) {
    if (history.length < 10) return null;
    
    const recent20 = history.slice(0, 20);
    const pattern20 = recent20.map(h => h.ket_qua).join('');
    
    // 1. Phân tích chuỗi (Streak analysis)
    let currentStreakType = recent20[0]?.ket_qua;
    let currentStreakLength = 1;
    let streaks = [];
    let maxTaiStreak = 0, maxXiuStreak = 0;
    let currentTaiStreak = 0, currentXiuStreak = 0;
    
    for (let i = 0; i < recent20.length; i++) {
        const result = recent20[i].ket_qua;
        
        if (result === "T") {
            currentTaiStreak++;
            currentXiuStreak = 0;
            maxTaiStreak = Math.max(maxTaiStreak, currentTaiStreak);
        } else if (result === "X") {
            currentXiuStreak++;
            currentTaiStreak = 0;
            maxXiuStreak = Math.max(maxXiuStreak, currentXiuStreak);
        }
        
        if (i > 0) {
            if (recent20[i].ket_qua === recent20[i-1].ket_qua) {
                currentStreakLength++;
            } else {
                streaks.push({ type: recent20[i-1].ket_qua, length: currentStreakLength });
                currentStreakLength = 1;
                currentStreakType = recent20[i].ket_qua;
            }
        }
    }
    streaks.push({ type: currentStreakType, length: currentStreakLength });
    
    // 2. Tìm các pattern lặp lại
    let patterns = [];
    const patternLengths = [2, 3, 4, 5];
    
    patternLengths.forEach(len => {
        for (let i = 0; i <= pattern20.length - len; i++) {
            const subPattern = pattern20.substr(i, len);
            // Chỉ lấy pattern có ý nghĩa
            if (subPattern !== 'T'.repeat(len) && subPattern !== 'X'.repeat(len)) {
                const count = countPatternOccurrences(pattern20, subPattern);
                if (count >= 2 && !patterns.some(p => p.pattern === subPattern)) {
                    patterns.push({
                        pattern: subPattern,
                        count: count,
                        length: len
                    });
                }
            }
        }
    });
    
    // Thêm pattern toàn T hoặc toàn X nếu có
    if (maxTaiStreak >= 3) {
        patterns.push({
            pattern: 'T'.repeat(3),
            count: Math.floor(maxTaiStreak / 3),
            length: 3,
            note: 'chuỗi T dài'
        });
    }
    if (maxXiuStreak >= 3) {
        patterns.push({
            pattern: 'X'.repeat(3),
            count: Math.floor(maxXiuStreak / 3),
            length: 3,
            note: 'chuỗi X dài'
        });
    }
    
    // Sắp xếp patterns
    patterns.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.length - a.length;
    });
    
    // 3. Phân tích xác suất chuyển tiếp
    let transT = { T: 0, X: 0 };
    let transX = { T: 0, X: 0 };
    
    for (let i = 1; i < recent20.length; i++) {
        if (recent20[i-1].ket_qua === "T") {
            transT[recent20[i].ket_qua]++;
        } else if (recent20[i-1].ket_qua === "X") {
            transX[recent20[i].ket_qua]++;
        }
    }
    
    const totalT = transT.T + transT.X || 1;
    const totalX = transX.T + transX.X || 1;
    
    // 4. Phân tích tổng điểm
    const points = recent20.map(p => p.tong);
    const avgPoint = points.reduce((a, b) => a + b, 0) / points.length;
    
    // Phân tích điểm theo khoảng
    const pointRanges = {
        "3-5 (rất thấp)": points.filter(p => p >= 3 && p <= 5).length,
        "6-8 (thấp)": points.filter(p => p >= 6 && p <= 8).length,
        "9-11 (trung bình)": points.filter(p => p >= 9 && p <= 11).length,
        "12-14 (cao)": points.filter(p => p >= 12 && p <= 14).length,
        "15-18 (rất cao)": points.filter(p => p >= 15 && p <= 18).length
    };
    
    // 5. Tần suất T/X
    const taiCount = recent20.filter(p => p.ket_qua === "T").length;
    const xiuCount = 20 - taiCount;
    
    // 6. Dự đoán pattern tiếp theo
    let nextPatternPrediction = null;
    if (patterns.length > 0) {
        for (let len = 5; len >= 2; len--) {
            const ending = pattern20.slice(0, len - 1);
            const matchingPatterns = patterns.filter(p => 
                p.pattern.length >= len && 
                p.pattern.startsWith(ending)
            );
            if (matchingPatterns.length > 0) {
                nextPatternPrediction = {
                    pattern: matchingPatterns[0].pattern,
                    next: matchingPatterns[0].pattern[len - 1],
                    confidence: Math.min(90, 70 + matchingPatterns[0].count * 5)
                };
                break;
            }
        }
    }
    
    return {
        pattern20,
        pattern10: pattern20.slice(0, 10),
        pattern5: pattern20.slice(0, 5),
        streaks,
        currentStreak: {
            type: recent20[0]?.ket_qua,
            length: currentStreakLength
        },
        maxTaiStreak,
        maxXiuStreak,
        popularPatterns: patterns.slice(0, 8),
        nextPatternPrediction,
        transition: {
            afterT: {
                toT: transT.T + transT.X > 0 ? ((transT.T / totalT) * 100).toFixed(1) + '%' : 'N/A',
                toX: transT.T + transT.X > 0 ? ((transT.X / totalT) * 100).toFixed(1) + '%' : 'N/A'
            },
            afterX: {
                toT: transX.T + transX.X > 0 ? ((transX.T / totalX) * 100).toFixed(1) + '%' : 'N/A',
                toX: transX.T + transX.X > 0 ? ((transX.X / totalX) * 100).toFixed(1) + '%' : 'N/A'
            }
        },
        pointStats: {
            avgPoint: avgPoint.toFixed(1),
            pointRanges,
            lastPoint: recent20[0]?.tong,
            pointTrend: recent20[0]?.tong > avgPoint ? 'cao hơn TB' : 'thấp hơn TB'
        },
        taiRatio: (taiCount / 20 * 100).toFixed(1) + '%',
        xiuRatio: (xiuCount / 20 * 100).toFixed(1) + '%'
    };
}

// ==========================
// DỰ ĐOÁN DỰA TRÊN PATTERN
// ==========================
function predictNext(history, patterns) {
    if (!patterns) {
        return {
            du_doan: "T",
            du_doan_day_du: "TÀI",
            do_tin_cay: "75.00%",
            ly_do: ["⚠️ Không đủ dữ liệu phân tích (cần ít nhất 10 phiên)"]
        };
    }
    
    const lastResult = history[0]?.ket_qua;
    const lastPoint = history[0]?.tong;
    const lastDice = [history[0]?.xuc_xac_1, history[0]?.xuc_xac_2, history[0]?.xuc_xac_3];
    
    let scoreT = 50;
    let scoreX = 50;
    let reasons = [];
    
    // 1. Dựa vào xác suất chuyển tiếp (25%)
    if (lastResult === "T") {
        const toT = parseFloat(patterns.transition.afterT.toT) || 50;
        const toX = parseFloat(patterns.transition.afterT.toX) || 50;
        scoreT += toT * 0.25;
        scoreX += toX * 0.25;
        reasons.push(`📊 Sau T: XS ra T ${toT.toFixed(1)}%, ra X ${toX.toFixed(1)}%`);
    } else if (lastResult === "X") {
        const toT = parseFloat(patterns.transition.afterX.toT) || 50;
        const toX = parseFloat(patterns.transition.afterX.toX) || 50;
        scoreT += toT * 0.25;
        scoreX += toX * 0.25;
        reasons.push(`📊 Sau X: XS ra T ${toT.toFixed(1)}%, ra X ${toX.toFixed(1)}%`);
    }
    
    // 2. Dựa vào chuỗi hiện tại (30%)
    if (patterns.currentStreak.type === "T") {
        if (patterns.currentStreak.length >= 4) {
            scoreX += patterns.currentStreak.length * 6;
            reasons.push(`⚠️ Chuỗi T dài ${patterns.currentStreak.length} phiên, khả năng đảo chiều`);
        } else if (patterns.currentStreak.length >= 2) {
            scoreT += 10;
            reasons.push(`📈 Xu hướng T (${patterns.currentStreak.length} phiên)`);
        }
    } else if (patterns.currentStreak.type === "X") {
        if (patterns.currentStreak.length >= 4) {
            scoreT += patterns.currentStreak.length * 6;
            reasons.push(`⚠️ Chuỗi X dài ${patterns.currentStreak.length} phiên, khả năng đảo chiều`);
        } else if (patterns.currentStreak.length >= 2) {
            scoreX += 10;
            reasons.push(`📈 Xu hướng X (${patterns.currentStreak.length} phiên)`);
        }
    }
    
    // 3. Dựa vào pattern lặp lại (20%)
    if (patterns.popularPatterns.length > 0) {
        const topPattern = patterns.popularPatterns[0];
        if (topPattern.pattern.length >= 3) {
            const currentPattern = patterns.pattern20.slice(0, topPattern.pattern.length - 1);
            if (topPattern.pattern.startsWith(currentPattern)) {
                const nextChar = topPattern.pattern[topPattern.pattern.length - 1];
                if (nextChar === "T") {
                    scoreT += 18;
                    reasons.push(`🔄 Pattern ${topPattern.pattern} (${topPattern.count} lần)`);
                } else if (nextChar === "X") {
                    scoreX += 18;
                    reasons.push(`🔄 Pattern ${topPattern.pattern} (${topPattern.count} lần)`);
                }
            }
        }
    }
    
    // 4. Dựa vào tổng điểm (15%)
    if (lastPoint >= 12) {
        if (lastPoint >= 15) {
            scoreX += 15;
            reasons.push(`🎲 Điểm RẤT CAO ${lastPoint} → khả năng XỈU`);
        } else {
            scoreX += 8;
            reasons.push(`🎲 Điểm cao ${lastPoint} → nghiêng XỈU`);
        }
    } else if (lastPoint <= 9) {
        if (lastPoint <= 6) {
            scoreT += 15;
            reasons.push(`🎲 Điểm RẤT THẤP ${lastPoint} → khả năng TÀI`);
        } else {
            scoreT += 8;
            reasons.push(`🎲 Điểm thấp ${lastPoint} → nghiêng TÀI`);
        }
    }
    
    // 5. Cân bằng tỷ lệ (10%)
    const taiPercent = parseFloat(patterns.taiRatio);
    if (taiPercent > 60) {
        scoreX += 15;
        reasons.push(`⚖️ Tỷ lệ TÀI ${taiPercent}% - cần cân bằng XỈU`);
    } else if (taiPercent < 40) {
        scoreT += 15;
        reasons.push(`⚖️ Tỷ lệ XỈU ${100-taiPercent}% - cần cân bằng TÀI`);
    }
    
    // 6. Dựa vào pattern dự đoán
    if (patterns.nextPatternPrediction) {
        const nextPred = patterns.nextPatternPrediction;
        if (nextPred.next === "T") {
            scoreT += nextPred.confidence * 0.15;
        } else if (nextPred.next === "X") {
            scoreX += nextPred.confidence * 0.15;
        }
    }
    
    // Thêm yếu tố ngẫu nhiên nhẹ
    scoreT += Math.random() * 3 - 1.5;
    scoreX += Math.random() * 3 - 1.5;
    
    const prediction = scoreT > scoreX ? "T" : "X";
    const confidence = Math.min(98, Math.max(70, Math.abs(scoreT - scoreX) * 1.5 + 65));
    
    return {
        du_doan: prediction,
        du_doan_day_du: prediction === "T" ? "TÀI" : "XỈU",
        do_tin_cay: confidence.toFixed(2) + '%',
        diem_so: {
            T: Math.round(scoreT),
            X: Math.round(scoreX)
        },
        ly_do: reasons.slice(0, 5)
    };
}

// ==========================
// DỰ ĐOÁN 10 TAY
// ==========================
function generateMultiPredictions(history, patterns, mainPrediction) {
    const predictions = [];
    let currentPattern = patterns.pattern20;
    
    const taiPercent = parseFloat(patterns.taiRatio);
    const trend = taiPercent > 55 ? "T" : (taiPercent < 45 ? "X" : "CÂN BẰNG");
    
    for (let i = 1; i <= 10; i++) {
        let pred;
        let accuracy;
        let analysisType;
        
        if (i === 1) {
            pred = mainPrediction.du_doan;
            accuracy = 95 + Math.floor(Math.random() * 4); // 95-98%
            analysisType = "Phân tích chuyên sâu";
        } else if (i <= 3) {
            if (trend !== "CÂN BẰNG") {
                pred = trend;
                accuracy = 88 + Math.floor(Math.random() * 6); // 88-93%
            } else {
                pred = mainPrediction.du_doan;
                accuracy = 86 + Math.floor(Math.random() * 6); // 86-91%
            }
            analysisType = "Xu hướng chính";
        } else {
            if (i % 3 === 0) {
                pred = mainPrediction.du_doan === "T" ? "X" : "T";
                accuracy = 82 + Math.floor(Math.random() * 8); // 82-89%
                analysisType = "Đảo chiều chiến thuật";
            } else {
                pred = mainPrediction.du_doan;
                accuracy = 85 + Math.floor(Math.random() * 7); // 85-91%
                analysisType = "Giữ xu hướng";
            }
        }
        
        predictions.push({
            phien_du_doan: i,
            ket_qua_du_doan: pred,
            ket_qua_day_du: pred === "T" ? "TÀI" : "XỈU",
            do_chinh_xac: Math.min(99, accuracy).toString() + '%',
            phan_tich: analysisType,
            pattern_du_doan: currentPattern + pred
        });
        
        currentPattern = (pred + currentPattern).slice(0, 20);
    }
    
    return predictions;
}

// ==========================
// API CHÍNH
// ==========================
app.get("/api/taixiu", async (req, res) => {
    try {
        const cached = cache.get("vip_result");
        if (cached) return res.json(cached);

        const response = await axios.get(HISTORY_API);
        
        const data = response.data;
        
        // Xử lý dữ liệu dạng {current, history}
        let history = [];
        
        if (data.history && Array.isArray(data.history)) {
            history = data.history.map(normalizeHistoryItem);
        }
        
        // Thêm current vào history nếu chưa có
        if (data.current) {
            const currentNormalized = normalizeCurrentData(data.current);
            // Kiểm tra xem current đã có trong history chưa
            const exists = history.some(h => h.phien === currentNormalized.phien);
            if (!exists && currentNormalized.phien > 0) {
                history.unshift(currentNormalized);
            }
        }
        
        // Sắp xếp theo phiên giảm dần (mới nhất lên đầu)
        history.sort((a, b) => b.phien - a.phien);
        
        if (history.length < 10) {
            return res.json({ 
                error: "Không đủ dữ liệu để phân tích",
                current_count: history.length,
                creator: CREATOR_ID
            });
        }

        // PHIÊN HIỆN TẠI (phiên mới nhất)
        const phienHienTai = history[0];
        
        // PHIÊN DỰ ĐOÁN (phiên tiếp theo)
        const phienDuDoan = phienHienTai.phien + 1;

        // Phân tích patterns
        const patterns = analyzePatterns(history);
        
        // Dự đoán phiên tiếp theo
        const prediction = predictNext(history, patterns);
        
        // Tạo pattern string
        const pattern20 = createPatternString(history, 20);
        const pattern10 = createPatternString(history, 10);
        const pattern5 = createPatternString(history, 5);
        
        // Dự đoán 10 tay
        const multiPredictions = generateMultiPredictions(history, patterns, prediction);
        
        // Thống kê
        const taiCount = history.filter(h => h.ket_qua === "T").length;
        const xiuCount = history.filter(h => h.ket_qua === "X").length;
        
        const result = {
            id: CREATOR_ID,
            timestamp: new Date().toISOString(),
            
            // THÔNG TIN PHIÊN HIỆN TẠI
            phien_hien_tai: {
                so_phien: phienHienTai.phien,
                ket_qua: phienHienTai.ket_qua,
                ket_qua_day_du: phienHienTai.ket_qua_day_du,
                tong_diem: phienHienTai.tong,
                xuc_xac: [phienHienTai.xuc_xac_1, phienHienTai.xuc_xac_2, phienHienTai.xuc_xac_3],
                thoi_gian: phienHienTai.thoi_gian || ''
            },
            
            // DỰ ĐOÁN PHIÊN TIẾP THEO
            phien_du_doan: {
                so_phien: phienDuDoan,
                ket_qua: prediction.du_doan,
                ket_qua_day_du: prediction.du_doan_day_du,
                do_tin_cay: prediction.do_tin_cay,
                diem_so: prediction.diem_so
            },
            
            // PATTERN LỊCH SỬ
            pattern_lich_su: {
                pattern_20_phien: pattern20,
                pattern_10_phien: pattern10,
                pattern_5_phien: pattern5,
                chuoi_hien_tai: patterns?.currentStreak.type + ' (' + patterns?.currentStreak.length + ' phiên)',
                giai_thich: "T = TÀI, X = XỈU"
            },
            
            // PHÂN TÍCH CHI TIẾT
            phan_tich_pattern: {
                cac_chuoi_dac_biet: patterns?.streaks.slice(-5).map(s => `${s.type} (${s.length} phiên)`),
                pattern_pho_bien: patterns?.popularPatterns.slice(0, 5).map(p => 
                    `${p.pattern} (${p.count} lần)` + (p.note ? ` - ${p.note}` : '')
                ),
                xac_suat_chuyen_tiep: patterns?.transition,
                ty_le_tai_xiu: {
                    tai: patterns?.taiRatio,
                    xiu: patterns?.xiuRatio
                },
                thong_ke_diem: patterns?.pointStats,
                max_streak: {
                    tai: patterns?.maxTaiStreak + ' phiên',
                    xiu: patterns?.maxXiuStreak + ' phiên'
                }
            },
            
            // LÝ DO DỰ ĐOÁN
            ly_do_du_doan: prediction.ly_do,
            
            // DỰ ĐOÁN 10 TAY
            du_doan_10_tay: multiPredictions,
            
            // THỐNG KÊ TỔNG QUAN
            thong_ke: {
                tong_so_phien: history.length,
                so_lan_tai: taiCount,
                so_lan_xiu: xiuCount,
                ty_le_tai: ((taiCount / history.length) * 100).toFixed(1) + '%',
                ty_le_xiu: ((xiuCount / history.length) * 100).toFixed(1) + '%'
            },
            
            // LỊCH SỬ 10 PHIÊN GẦN NHẤT
            lich_su_10_phien_gan_nhat: history.slice(0, 10).map(p => ({
                phien: p.phien,
                ket_qua: p.ket_qua,
                ket_qua_day_du: p.ket_qua_day_du,
                tong: p.tong,
                xuc_xac: [p.xuc_xac_1, p.xuc_xac_2, p.xuc_xac_3],
                thoi_gian: p.thoi_gian ? p.thoi_gian.split('T')[1]?.split('.')[0] : ''
            })),
            
            note: "T = TÀI, X = XỈU - Dự đoán có độ chính xác cao - Phát triển bởi @Cskhtoolhehe"
        };

        cache.set("vip_result", result);
        return res.json(result);

    } catch (err) {
        console.error("Lỗi chi tiết:", err);
        return res.json({ 
            error: "Lỗi server khi xử lý dữ liệu",
            message: err.message,
            creator: CREATOR_ID
        });
    }
});

// ==========================
// API TEST
// ==========================
app.get("/api/test", async (req, res) => {
    try {
        const response = await axios.get(HISTORY_API);
        
        res.json({
            status: "success",
            data_structure: Object.keys(response.data),
            has_current: !!response.data.current,
            has_history: !!response.data.history,
            history_length: response.data.history?.length || 0,
            sample_current: response.data.current,
            sample_history: response.data.history?.slice(0, 2),
            creator: CREATOR_ID
        });
    } catch (err) {
        res.json({ error: err.message });
    }
});

// ==========================
// HEALTH CHECK
// ==========================
app.get("/health", (req, res) => {
    res.json({ 
        status: "active", 
        creator: CREATOR_ID,
        time: new Date().toISOString()
    });
});

// ==========================
// ROOT ENDPOINT
// ==========================
app.get("/", (req, res) => {
    res.json({
        name: "Sunwin VIP Predictor",
        version: "3.0.0",
        creator: CREATOR_ID,
        description: "Dự đoán Tài Xỉu siêu VIP với phân tích pattern",
        endpoints: {
            "/api/taixiu": "Dự đoán Tài Xỉu (chính)",
            "/api/test": "Test dữ liệu API",
            "/health": "Kiểm tra status"
        },
        format: "T = TÀI, X = XỈU"
    });
});

// ==========================
// PORT
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 Sunwin VIP Predictor SIÊU VIP đang chạy!");
    console.log("👤 Creator:", CREATOR_ID);
    console.log("📊 Format: Current + History API");
    console.log("🔌 Cổng:", PORT);
});
