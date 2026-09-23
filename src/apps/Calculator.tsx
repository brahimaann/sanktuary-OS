import React, { useState, useEffect } from 'react';

interface CalculatorProps {
  isFocused?: boolean;
}

export const Calculator: React.FC<CalculatorProps> = ({ isFocused = false }) => {
  const [display, setDisplay] = useState('0');
  const [memory, setMemory] = useState<number | null>(null);
  const [equation, setEquation] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [resetDisplayOnNextInput, setResetDisplayOnNextInput] = useState(false);

  const handleDigit = (digit: string) => {
    if (resetDisplayOnNextInput || display === '0') {
      setDisplay(digit);
      setResetDisplayOnNextInput(false);
    } else {
      setDisplay(display + digit);
    }
  };

  const handleDecimal = () => {
    if (resetDisplayOnNextInput) {
      setDisplay('0.');
      setResetDisplayOnNextInput(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setEquation(null);
    setPendingOp(null);
    setResetDisplayOnNextInput(false);
  };

  const handleCE = () => {
    setDisplay('0');
  };

  const handleBackspace = () => {
    if (resetDisplayOnNextInput) {
      setDisplay('0');
      setResetDisplayOnNextInput(false);
      return;
    }
    if (display.length <= 1) {
      setDisplay('0');
    } else {
      const next = display.slice(0, -1);
      if (next === '-' || next === '') {
        setDisplay('0');
      } else {
        setDisplay(next);
      }
    }
  };

  const handleOp = (op: string) => {
    const val = parseFloat(display);
    if (pendingOp && !resetDisplayOnNextInput) {
      const result = calculate(equation || 0, val, pendingOp);
      setDisplay(result.toString());
      setEquation(result);
    } else {
      setEquation(val);
    }
    setPendingOp(op);
    setResetDisplayOnNextInput(true);
  };

  const handleEquals = () => {
    if (!pendingOp) return;
    const val = parseFloat(display);
    const result = calculate(equation || 0, val, pendingOp);
    setDisplay(result.toString());
    setEquation(null);
    setPendingOp(null);
    setResetDisplayOnNextInput(true);
  };

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? 0 : a / b;
      default: return b;
    }
  };

  const handleSign = () => {
    if (display === '0') return;
    if (display.startsWith('-')) {
      setDisplay(display.slice(1));
    } else {
      setDisplay('-' + display);
    }
  };

  const handleSqrt = () => {
    const val = parseFloat(display);
    if (val < 0) {
      setDisplay('Invalid input.');
    } else {
      setDisplay(Math.sqrt(val).toString());
    }
    setResetDisplayOnNextInput(true);
  };

  const handlePercent = () => {
    const val = parseFloat(display);
    setDisplay((val / 100).toString());
    setResetDisplayOnNextInput(true);
  };

  const handleOneOverX = () => {
    const val = parseFloat(display);
    if (val === 0) {
      setDisplay('Cannot divide by zero.');
    } else {
      setDisplay((1 / val).toString());
    }
    setResetDisplayOnNextInput(true);
  };

  // Memory buttons
  const handleMC = () => setMemory(null);
  const handleMR = () => {
    if (memory !== null) {
      setDisplay(memory.toString());
      setResetDisplayOnNextInput(true);
    }
  };
  const handleMS = () => {
    setMemory(parseFloat(display));
    setResetDisplayOnNextInput(true);
  };
  const handleMPlus = () => {
    const currentMem = memory || 0;
    setMemory(currentMem + parseFloat(display));
    setResetDisplayOnNextInput(true);
  };

  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      if (/[0-9]/.test(key)) {
        e.preventDefault();
        handleDigit(key);
      } else if (key === '.') {
        e.preventDefault();
        handleDecimal();
      } else if (key === '+' || key === '-' || key === '*' || key === '/') {
        e.preventDefault();
        handleOp(key);
      } else if (key === '=' || key === 'Enter') {
        e.preventDefault();
        handleEquals();
      } else if (key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (key === 'Escape') {
        e.preventDefault();
        handleClear();
      } else if (key === 'Delete') {
        e.preventDefault();
        handleCE();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFocused, display, equation, pendingOp, resetDisplayOnNextInput, memory]);

  return (
    <div className="calculator flex flex-col p-2 bg-[#c0c0c0] w-full h-full text-xs select-none">
      {/* Menus */}
      <div className="flex border-b border-gray-400 pb-1 mb-2 font-sans">
        <span className="mr-3 cursor-default hover:bg-[#000080] hover:text-white px-1">Edit</span>
        <span className="mr-3 cursor-default hover:bg-[#000080] hover:text-white px-1">View</span>
        <span className="cursor-default hover:bg-[#000080] hover:text-white px-1">Help</span>
      </div>

      {/* Screen Display */}
      <div
        className="screen-display bg-white text-black text-right text-base px-2 py-1 mb-2 font-mono border-2 border-inset truncate flex items-center justify-end h-[35px]"
        style={{ borderColor: '#808080 #fff #fff #808080' }}
      >
        {display.includes('.') ? display : display + '.'}
      </div>

      {/* Controls Area */}
      <div className="flex flex-1 gap-2">
        {/* Memory Column */}
        <div className="flex flex-col justify-between w-[36px] gap-1">
          <button onClick={handleMC} className="h-full border border-outset font-bold text-red-800 bg-[#c0c0c0] active:border-inset">MC</button>
          <button onClick={handleMR} className="h-full border border-outset font-bold text-red-800 bg-[#c0c0c0] active:border-inset">MR</button>
          <button onClick={handleMS} className="h-full border border-outset font-bold text-red-800 bg-[#c0c0c0] active:border-inset">MS</button>
          <button onClick={handleMPlus} className="h-full border border-outset font-bold text-red-800 bg-[#c0c0c0] active:border-inset">M+</button>
        </div>

        {/* Buttons Grid */}
        <div className="flex-1 flex flex-col gap-1">
          {/* Back, CE, C Row */}
          <div className="flex gap-1 h-[28px]">
            <button onClick={handleBackspace} className="flex-1 border border-outset text-red-800 bg-[#c0c0c0] font-sans active:border-inset">Back</button>
            <button onClick={handleCE} className="flex-1 border border-outset text-red-800 bg-[#c0c0c0] font-sans active:border-inset">CE</button>
            <button onClick={handleClear} className="flex-1 border border-outset text-red-800 bg-[#c0c0c0] font-sans active:border-inset">C</button>
          </div>

          {/* Core Keys Layout Grid */}
          <div className="flex-1 grid grid-cols-5 gap-1">
            <button onClick={() => handleDigit('7')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">7</button>
            <button onClick={() => handleDigit('8')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">8</button>
            <button onClick={() => handleDigit('9')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">9</button>
            <button onClick={() => handleOp('/')} className="border border-outset text-red-800 bg-[#c0c0c0] font-bold active:border-inset">/</button>
            <button onClick={handleSqrt} className="border border-outset text-blue-900 bg-[#c0c0c0] active:border-inset">sqrt</button>

            <button onClick={() => handleDigit('4')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">4</button>
            <button onClick={() => handleDigit('5')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">5</button>
            <button onClick={() => handleDigit('6')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">6</button>
            <button onClick={() => handleOp('*')} className="border border-outset text-red-800 bg-[#c0c0c0] font-bold active:border-inset">*</button>
            <button onClick={handlePercent} className="border border-outset text-blue-900 bg-[#c0c0c0] active:border-inset">%</button>

            <button onClick={() => handleDigit('1')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">1</button>
            <button onClick={() => handleDigit('2')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">2</button>
            <button onClick={() => handleDigit('3')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">3</button>
            <button onClick={() => handleOp('-')} className="border border-outset text-red-800 bg-[#c0c0c0] font-bold active:border-inset">-</button>
            <button onClick={handleOneOverX} className="border border-outset text-blue-900 bg-[#c0c0c0] active:border-inset">1/x</button>

            <button onClick={() => handleDigit('0')} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">0</button>
            <button onClick={handleSign} className="border border-outset text-blue-900 bg-[#c0c0c0] active:border-inset">+/-</button>
            <button onClick={handleDecimal} className="border border-outset text-blue-900 bg-[#c0c0c0] font-bold active:border-inset">.</button>
            <button onClick={() => handleOp('+')} className="border border-outset text-red-800 bg-[#c0c0c0] font-bold active:border-inset">+</button>
            <button onClick={handleEquals} className="border border-outset text-red-800 bg-[#c0c0c0] font-bold active:border-inset">=</button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default Calculator;
