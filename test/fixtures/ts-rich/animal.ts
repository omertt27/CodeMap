export interface Named { name: string; }
export enum Kind { Dog, Cat }

export class Animal {
  move(): void {}
}

export class Dog extends Animal implements Named {
  name = "rex";
  bark(): void {}
}

export const MAX = 100;
let counter = 0;
