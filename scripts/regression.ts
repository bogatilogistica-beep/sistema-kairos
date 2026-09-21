/**
 * Regresión lineal múltiple por mínimos cuadrados ordinarios (ecuaciones normales),
 * usada para calibrar costoViaje = alpha + beta*kg + gamma*km contra el histórico real
 * de TRANSPORTE CONTROL DE FACTURAS. Sin dependencias externas: resuelve el sistema
 * 3x3 (X^T X) coef = X^T y por eliminación gaussiana.
 */
export interface RegresionInput {
  y: number[]; // costo del viaje
  x1: number[]; // kg transportados
  x2: number[]; // km estimados de la ruta
}

export interface RegresionResultado {
  alpha: number;
  beta: number;
  gamma: number;
  r2: number;
}

function solve3x3(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]]);
  const n = 3;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-9) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-9 ? 0 : row[3] / row[i]));
}

export function regresionLineal({ y, x1, x2 }: RegresionInput): RegresionResultado {
  const n = y.length;
  const sumX1 = x1.reduce((a, b) => a + b, 0);
  const sumX2 = x2.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumX1X1 = x1.reduce((a, v) => a + v * v, 0);
  const sumX2X2 = x2.reduce((a, v) => a + v * v, 0);
  const sumX1X2 = x1.reduce((a, v, i) => a + v * x2[i], 0);
  const sumX1Y = x1.reduce((a, v, i) => a + v * y[i], 0);
  const sumX2Y = x2.reduce((a, v, i) => a + v * y[i], 0);

  const A = [
    [n, sumX1, sumX2],
    [sumX1, sumX1X1, sumX1X2],
    [sumX2, sumX1X2, sumX2X2],
  ];
  const b = [sumY, sumX1Y, sumX2Y];
  const [alpha, beta, gamma] = solve3x3(A, b);

  const yMean = sumY / n;
  const ssTot = y.reduce((a, v) => a + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((a, v, i) => a + (v - (alpha + beta * x1[i] + gamma * x2[i])) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { alpha, beta, gamma, r2 };
}
