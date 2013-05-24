;(function(global, simple) {
  
  function assert(condition, message) {
    if (!condition) throw (message || "assertion failed");
  }
  
  var ops = simple.opcodes;
  
  var BIN_OPS = {
    '+'   : ops.ADD,
    '-'   : ops.SUB,
    '*'   : ops.MUL,
    '/'   : ops.DIV,
    '<'   : ops.LT,
    '<='  : ops.LE,
    '>'   : ops.GT,
    '>='  : ops.GE,
    '=='  : ops.EQ,
    '!='  : ops.NEQ
  };
  
  function Compiler() {
    this._fn = null;
  }
  
  Compiler.prototype = {
    emit: function(opcode, line) {
      this._fn.code.push(opcode);
      this._fn.sourceMap.push(line || 0);
    },
    
    compileFnDef: function(ast) {
      
      assert(ast.type === 'def');
      assert(Array.isArray(ast.parameters));
      assert(Array.isArray(ast.body));
      
      var oldFn = this._fn;
      var newFn = simple.makeFunction();
      
      this._fn = newFn;
      
      var params = ast.parameters;
      for (var i = 0; i < params.length; ++i) {
        newFn.slotForLocal(params[i]);
        newFn.minArgs++;
        newFn.maxArgs++;
      }
      
      this.compileFunctionBody(ast.body);
      
      this._env[ast.name] = newFn;
      
      this._fn = oldFn;
      
      return newFn;
      
    },
    
    compileAssign: function(ast) {
      
      assert(ast.type === 'assign');
      assert(ast.left.type === 'ident');
      
      var slot = this._fn.slotForLocal(ast.left.name);
      this.compileExpression(ast.right);
      this.emit(ops.SETL | (slot << 8), ast.line);
      
    },
    
    compileIf: function(ast) {
      
      var ix        = 0,
          firstAbs  = null,
          lastAbs   = null,
          clauses   = ast.clauses;
      
      while (ix < clauses.length) {
        var clause = clauses[ix];
        
        if (typeof clause.condition !== 'undefined') {
          this.compileExpression(clause.condition);
          
          var failJump = this._fn.code.length;
          this.emit(ops.JMPF);
          
          this.compileStatements(clause.body);
          
          if (firstAbs === null) {
            firstAbs = this._fn.code.length;
            lastAbs = this._fn.code.length;
            this.emit(0);
          } else {
            var tmp = this._fn.code.length;
            this.emit(lastAbs); // hack - stash pointer to last jump point so we can backtrack
            lastAbs = tmp;
          }
          
          this._fn.code[failJump] = ops.JMPF | ((this._fn.code.length - failJump - 1) << 8);
        } else {
          this.compileStatements(clause.body);
        }
        
        ix++;
      }
      
      var jmpOp   = ops.JMPA | (this._fn.code.length << 8),
          currAbs = lastAbs;
      
      do {
        var tmp = this._fn.code[currAbs];
        this._fn.code[currAbs] = jmpOp;
        if (currAbs == firstAbs) {
          break;
        } else {
          currAbs = tmp;
        }
      } while (true);
      
    },
    
    compileWhile: function(ast) {
      
      assert(ast.type === 'while');
      assert(typeof ast.condition === 'object');
      assert(Array.isArray(ast.body));
      
      var loopStart = this._fn.code.length;
      this.compileExpression(ast.condition);
      
      var failJump = this._fn.code.length;
      this.emit(ops.JMPF);
      
      this.compileStatements(ast.body);
      this.emit(ops.JMPA | (loopStart << 8));
      
      this._fn.code[failJump] = ops.JMPF | ((this._fn.code.length - failJump - 1) << 8);

    },
    
    compileLoop: function(ast) {
      var loopStart = this._fn.code.length;
      this.compileStatements(ast.body);
      this.emit(ops.YIELD, ast.line);
      this.emit(ops.JMPA | (loopStart << 8));
    },
    
    compileReturn: function(ast) {
      
      assert(ast.type === 'return');
      
      if (typeof ast.returnValue !== 'undefined') {
        this.compileExpression(ast.returnValue);
      } else {
        this.emit(ops.PUSHF); // TODO: should probably push undefined/null or whatever
      }
      
      this.emit(ops.RET, ast.line);
    
    },
    
    compileYield: function(ast) {
      this.emit(ops.YIELD, ast.line);
    },
    
    compileCall: function(ast) {
      
      assert(ast.type === 'call');
      assert(typeof ast.fn === 'object');
      assert(ast.fn.type === 'ident');
      assert(Array.isArray(ast.args));
      
      var args = ast.args;
      if (args.length > 255) {
        throw "compile error - max args per function call (255) exceeded";
      }
      
      for (var i = 0; i < args.length; ++i) {
        this.compileExpression(args[i]);
      }
      
      this.emit(ops.CALL | (args.length << 8) | (this._fn.slotForFunctionCall(ast.fn.name) << 16), ast.line);
      
    },
    
    compileLogicalAnd: function(ast) {
      
      this.compileExpression(ast.left);
      
      var bailJump = this._fn.code.length;
      this.emit(0);
      
      this.compileExpression(ast.right);
      
      this._fn.code[bailJump] = ops.JMPF_OP | ((this._fn.code.length - bailJump - 1) << 8);

    },
    
    compileLogicalOr: function(ast) {
      
      this.compileExpression(ast.left);
      
      var bailJump = this._fn.code.length;
      this.emit(0);
      
      this.compileExpression(ast.right);
      
      this._fn.code[bailJump] = ops.JMPT_OP | ((this._fn.code.length - bailJump - 1) << 8);
      
    },
    
    compileExpression: function(ast) {
      if (ast === true) {
        this.emit(ops.PUSHT, ast.line);
      } else if (ast === false) {
        this.emit(ops.PUSHF, ast.line);
      } else if (typeof ast == 'number' || typeof ast == 'string') {
        this.emit(ops.PUSHC | (this._fn.slotForConstant(ast) << 8), ast.line);
      } else {
        switch (ast.type) {
          case 'assign':
            this.compileAssign(ast);
            break;
          case 'trace':
            this.emit(ops.TRACE, ast.line);
            break;
          case 'ident':
            this.emit(ops.PUSHL | (this._fn.slotForLocal(ast.name) << 8), ast.line);
            break;
          case 'call':
            this.compileCall(ast);
            break;
          default:
            if (ast.type === 'logical-and') {
              this.compileLogicalAnd(ast);
            } else if (ast.type === 'logical-or') {
              this.compileLogicalOr(ast);
            } else if (ast.type in BIN_OPS) {
              this.compileExpression(ast.left);
              this.compileExpression(ast.right);
              this.emit(BIN_OPS[ast.type], ast.line);
            } else {
              throw "unknown expression - " + ast;
            }
            break;
        }
      }
    },
    
    compileStatement: function(ast) {
      if (ast.type) {
        switch (ast.type) {
          case 'def':
            this.compileFnDef(ast);
            break;
          case 'if':
            this.compileIf(ast);
            break;
          case 'while':
            this.compileWhile(ast);
            break;
          case 'loop':
            this.compileLoop(ast);
            break;
          case 'return':
            this.compileReturn(ast);
            break;
          case 'yield':
            this.compileYield(ast);
            break;
          default:
            this.compileExpression(ast);
            this.emit(ops.SETZ);
            break;
          }
      } else {
        this.compileExpression(ast);
        this.emit(ops.SETZ);
      }
    },
    
    compileStatements: function(statements) {
      for (var i = 0; i < statements.length; ++i) {
        this.compileStatement(statements[i]);
      }
    },
    
    compileFunctionBody: function(statements) {
      this.compileStatements(statements);
      this.emit(ops.PUSHZ);
      this.emit(ops.RET);
    },
    
    compile: function(ast) {
      this._env = {};
      this._fn = simple.makeFunction();
      
      this.compileFunctionBody(ast);
      
      return {
        topLevelFn  : this._fn,
        symbols     : this._env
      };
    }
  };
  
  simple.Compiler = Compiler;
  
})(this, simple);