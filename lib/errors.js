"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SemanticError extends Error {
    constructor(message = 'Semantic error', { fileName = 'Unknown', line = 0, column = 0 } = {}) {
        super(message);
        this.name = 'SemanticError';
        this.fileName = fileName;
        this.line = line;
        this.column = column;
    }
}
exports.SemanticError = SemanticError;
class SyntaxError extends Error {
    constructor(message = 'Syntax error', { fileName = 'Unknown', line = 0, column = 0 } = {}) {
        super(message);
        this.name = 'SyntaxError';
        this.fileName = fileName;
        this.line = line;
        this.column = column;
    }
}
exports.SyntaxError = SyntaxError;
class LexicalError extends Error {
    constructor(message = 'Lexical error', { fileName = 'Unknown', line = 0, column = 0 } = {}) {
        super(message);
        this.name = 'LexicalError';
        this.fileName = fileName;
        this.line = line;
        this.column = column;
    }
}
exports.LexicalError = LexicalError;
//# sourceMappingURL=errors.js.map