declare module "spark-md5" {
  const SparkMD5: {
    hash(value: string): string;
    ArrayBuffer: { hash(value: ArrayBuffer): string };
  };
  export default SparkMD5;
}
