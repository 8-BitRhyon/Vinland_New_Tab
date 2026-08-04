// CalcPreview.js — pure functions for calc blocks, extracted from BlockEditor
// (L8 monolith decomposition). Zero DOM/state dependencies: given a string,
// produce the safe preview HTML or the evaluated result.
//
// Kept dependency-free (only escapeHtml from Utils) so the XSS-guard test can
// assert the sinks stay escaped without loading the whole editor.

import { escapeHtml } from '../core/Utils.js';

// Renders a calc block's content as preview HTML. `text` is the raw block
// content (e.g. "2 + 2 // = 4"); the expression and result spans are both
// HTML-escaped before interpolation (L6 hardening).
export function getCalcPreviewHtml(text) {
    var parts = (text || '').split('//');
    var expr = parts[0].trim();
    var result = parts.length > 1 ? parts[1].replace('=', '').trim() : '';

    var html = '<div class="calc-preview" style="margin:0; border:none; background:transparent; padding:0;">';
    html += '<span class="calc-expression">' + escapeHtml(expr) + '</span>';
    if (result) {
        html += '<span class="calc-arrow" style="margin:0 8px;">&rarr;</span>';
        html += '<span class="calc-result">' + escapeHtml(result) + '</span>';
    }
    return html + '</div>';
}

// Safely evaluate a math expression without eval(). Tokenizes, shunts to RPN,
// evaluates. Returns a number or an 'Error: ...' string. Extracted verbatim
// from BlockEditor.safeMathEval (L8).
export function safeMathEval(expr) {
    var tokens = [];
    var numberBuffer = '';
    expr = expr.split('//')[0].trim();
    expr = expr.replace(/x/gi, '*').replace(/×/g, '*');
    expr = expr.replace(/÷/g, '/').replace(/:/g, '/');
    expr = expr.replace(/\s+/g, '');

    for (var i = 0; i < expr.length; i++) {
        var char = expr[i];
        if (/\d|\./.test(char)) {
            numberBuffer += char;
        } else {
            if (numberBuffer.length > 0) {
                tokens.push(parseFloat(numberBuffer));
                numberBuffer = '';
            }
            if ('+-*/^%()'.indexOf(char) !== -1) {
                if (char === '-' && (tokens.length === 0 || typeof tokens[tokens.length - 1] === 'string' && tokens[tokens.length - 1] !== ')')) {
                    numberBuffer += '-';
                } else {
                    tokens.push(char);
                }
            }
        }
    }
    if (numberBuffer.length > 0) tokens.push(parseFloat(numberBuffer));

    var outputQueue = [];
    var operatorStack = [];
    var precedence = { '^': 4, '*': 3, '/': 3, '%': 3, '+': 2, '-': 2 };
    var associativity = { '^': 'Right', '*': 'Left', '/': 'Left', '%': 'Left', '+': 'Left', '-': 'Left' };
    var isNum = function(t) { return typeof t === 'number' && !isNaN(t); };

    for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (isNum(token)) {
            outputQueue.push(token);
        } else if ('+-*/^%'.indexOf(token) !== -1) {
            while (operatorStack.length > 0) {
                var top = operatorStack[operatorStack.length - 1];
                if (top === '(') break;
                if ((associativity[token] === 'Left' && precedence[token] <= precedence[top]) ||
                    (associativity[token] === 'Right' && precedence[token] < precedence[top])) {
                    outputQueue.push(operatorStack.pop());
                } else {
                    break;
                }
            }
            operatorStack.push(token);
        } else if (token === '(') {
            operatorStack.push(token);
        } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                outputQueue.push(operatorStack.pop());
            }
            if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] === '(') {
                operatorStack.pop();
            } else return 'Error: Mismatched parentheses';
        }
    }
    while (operatorStack.length > 0) {
        var op = operatorStack.pop();
        if (op === '(') return 'Error: Mismatched parentheses';
        outputQueue.push(op);
    }

    var evalStack = [];
    for (var i = 0; i < outputQueue.length; i++) {
        var token = outputQueue[i];
        if (isNum(token)) {
            evalStack.push(token);
        } else {
            if (evalStack.length < 2) return 'Error: Invalid expression';
            var b = evalStack.pop();
            var a = evalStack.pop();
            var res = 0;
            switch (token) {
                case '+': res = a + b; break;
                case '-': res = a - b; break;
                case '*': res = a * b; break;
                case '/': res = a / b; break;
                case '%': res = a % b; break;
                case '^': res = Math.pow(a, b); break;
            }
            evalStack.push(res);
        }
    }
    return evalStack.length === 1 ? evalStack[0] : 'Error: Invalid expression';
}
