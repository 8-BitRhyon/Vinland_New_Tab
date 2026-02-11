/* =========================================
   SAFE CALCULATOR (CSP Compliant)
   ========================================= */

export function safeCalculate(expression) {
    if (!expression) return '';
    // Remove unsafe chars
    expression = expression.replace(/[^0-9+\-*/(). ]/g, '');
    var tokens = expression.match(/(\d+(\.\d+)?|[-+*/()])/g);
    if (!tokens) return 'INVALID';

    var pos = 0;
    var MAX_DEPTH = 50; // V18.11: Prevent stack overflow

    function parseExpression(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        var lhs = parseTerm(depth);
        while (pos < tokens.length) {
            var op = tokens[pos];
            if (op === '+' || op === '-') {
                pos++;
                var rhs = parseTerm(depth);
                if (op === '+') lhs += rhs; else lhs -= rhs;
            } else break;
        }
        return lhs;
    }

    function parseTerm(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        var lhs = parseFactor(depth);
        while (pos < tokens.length) {
            var op = tokens[pos];
            if (op === '*' || op === '/') {
                pos++;
                var rhs = parseFactor(depth);
                if (op === '*') lhs *= rhs; else lhs /= rhs;
            } else break;
        }
        return lhs;
    }

    function parseFactor(depth) {
        if (depth > MAX_DEPTH) throw new Error('MAX_DEPTH');
        if (pos >= tokens.length) return 0;
        var token = tokens[pos++];
        if (token === '(') {
            var result = parseExpression(depth + 1); // V18.11: Increment depth on nesting
            pos++; // skip )
            return result;
        }
        return parseFloat(token);
    }

    try {
        var result = parseExpression(0);
        return isNaN(result) ? 'ERROR' : Math.round(result * 100000) / 100000;
    } catch (e) { return 'ERROR'; }
}

export const SafeCalc = {
    calculate: safeCalculate
};
