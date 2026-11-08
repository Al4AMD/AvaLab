export type LaneParams<T> = {
  readonly primary: T;
  readonly right?: T;
};

export type ResolvedLaneParams<T> = {
  readonly left: T;
  readonly right: T;
};

export function resolveLaneParams<T>(params: LaneParams<T>): ResolvedLaneParams<T> {
  return {
    left: params.primary,
    right: params.right ?? params.primary,
  };
}

export function laneParamsLinked<T>(params: LaneParams<T>): boolean {
  return params.right === undefined;
}

export function unlinkLaneParams<T>(params: LaneParams<T>): LaneParams<T> {
  if (params.right !== undefined) {
    return params;
  }
  return { primary: params.primary, right: params.primary };
}

export function relinkLaneParams<T>(params: LaneParams<T>): LaneParams<T> {
  return { primary: params.primary };
}

export function setPrimaryLane<T>(params: LaneParams<T>, primary: T): LaneParams<T> {
  return params.right === undefined ? { primary } : { primary, right: params.right };
}

export function setRightLane<T>(params: LaneParams<T>, right: T): LaneParams<T> {
  return { primary: params.primary, right };
}
