// Lightning nodes that the page labels by name.
// Only add entries that a primary source documents, and say no more than that source says.

const SPARK_ROUTING_NODE = {
  label: 'Spark routing node',
  operator: 'Spark (developed by Lightspark)',
  // Listed as "our routing nodes" in the official Spark documentation:
  source: 'https://docs.spark.money/learn/lightning',
};

export const KNOWN_NODES = {
  '02a98e8c590a1b5602049d6b21d8f4c8861970aa310762f42eae1b2be88372e924': SPARK_ROUTING_NODE,
  '039174f846626c6053ba80f5443d0db33da384f1dde135bf7080ba1eec465019c3': SPARK_ROUTING_NODE,
};
