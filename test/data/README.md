# Real payment test data

`test_data_pre-images.csv` is the optional, private regression dataset. It must have this header:

```csv
payment_preimage,bolt11
```

The file is ignored by Git because invoices can contain personal payment information. Never force-add it. When it is absent (including in CI), the test harness uses `test_data_pre-images.example.csv`, which contains one already-public test vector.

See the root [README](../../README.md#testing-with-a-real-cln-export) for the CLN export query and setup instructions.
