export type ArrayValue<T> = T extends unknown[] ? T[number] : T;
export class Recorder<
  Recordings extends Record<string, Record<string, unknown[]>>,
> {
  public constructor(public recordings: Recordings = {} as Recordings) {}

  public record<
    Bucket extends keyof Recordings,
    Key extends keyof Recordings[Bucket],
  >(
    bucket: Bucket,
    key: Key,
    value: ArrayValue<Recordings[Bucket][Key]>
  ): void {
    this.recordings[bucket] ??= {} as Recordings[Bucket];
    this.recordings[bucket][key] ??= [] as Recordings[Bucket][Key];
    this.recordings[bucket][key].push(value);
  }

  public getRecorded<
    Bucket extends keyof Recordings,
    Key extends keyof Recordings[Bucket],
  >(bucket: Bucket, key: Key) {
    const values = this.recordings[bucket]?.[key] ?? [];
    const value = values.shift() as ArrayValue<Recordings[Bucket][Key]>;
    this.recordings[bucket][key] = values as Recordings[Bucket][Key];
    return value;
  }
}
