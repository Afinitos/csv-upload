import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import CsvUploadMapper, { defaultAssetColumns, type ColumnMapping } from "./CsvUploadMapper";

describe("CsvUploadMapper", () => {
  const csvSample = [
    // headers
    "Asset ID,Unique Identifier",
    // valid row
    "123,a-1",
    // missing Asset ID (required) -> invalid
    ",b-2",
    // non-numeric Asset ID -> invalid
    "abc,c-3",
  ].join("\n");

  it("auto-maps headers, allows mapping changes, and validates + edits rows before submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CsvUploadMapper
        expectedColumns={defaultAssetColumns()}
        onSubmit={onSubmit}
        initialCsvText={csvSample}
      />
    );

    // Step 2 (map) should be visible due to initialCsvText
    const applyBtn = await screen.findByTestId("apply-mapping");

    // Auto-mapped selects should have the proper values
    const assetSelect = screen.getByTestId("mapping-select-assetId") as HTMLSelectElement;
    const uidSelect = screen.getByTestId("mapping-select-uniqueIdentifier") as HTMLSelectElement;

    expect(assetSelect.value).toBe("Asset ID");
    expect(uidSelect.value).toBe("Unique Identifier");
    expect(applyBtn).toBeEnabled();

    // Unmap a required field -> button should disable
    await user.selectOptions(assetSelect, "");
    expect(applyBtn).toBeDisabled();

    // Map it back and proceed
    await user.selectOptions(assetSelect, "Asset ID");
    expect(applyBtn).toBeEnabled();

    await user.click(applyBtn);

    // Now in edit step: table present, validation badge shows 2 issues
    expect(await screen.findByText("3. Validate and edit data")).toBeInTheDocument();
    expect(screen.getByText(/validation issue\(s\)/i)).toHaveTextContent("2");

    // Fix row 2 (index 1) missing Asset ID -> set to 456
    const r2Asset = screen.getByTestId("cell-1-assetId") as HTMLInputElement;
    await user.clear(r2Asset);
    await user.type(r2Asset, "456");

    // One issue remains (row 3 numeric invalid)
    expect(screen.getByText(/validation issue\(s\)/i)).toBeInTheDocument();

    // Fix row 3 (index 2) non-numeric Asset ID -> set to 789
    const r3Asset = screen.getByTestId("cell-2-assetId") as HTMLInputElement;
    await user.clear(r3Asset);
    await user.type(r3Asset, "789");

    // All rows valid now, submit enabled
    expect(screen.getByText("All rows valid")).toBeInTheDocument();
    const submitBtn = screen.getByTestId("submit-button");
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    // Assert payload contents
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as {
      rows: Array<Record<string, string>>;
      mapping: ColumnMapping;
    };
    expect(payload.mapping.assetId).toBe("Asset ID");
    expect(payload.mapping.uniqueIdentifier).toBe("Unique Identifier");

    // Rows should reflect edits
    expect(payload.rows).toEqual([
      { assetId: "123", uniqueIdentifier: "a-1" },
      { assetId: "456", uniqueIdentifier: "b-2" },
      { assetId: "789", uniqueIdentifier: "c-3" },
    ]);
  });

  it("allows submit with errors when allowSubmitWithErrors is true", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    // CSV with one invalid row (missing Asset ID)
    const csv = ["Asset ID,Unique Identifier", ",x-1"].join("\n");

    render(
      <CsvUploadMapper
        expectedColumns={defaultAssetColumns()}
        onSubmit={onSubmit}
        initialCsvText={csv}
        allowSubmitWithErrors
      />
    );

    const applyBtn = await screen.findByTestId("apply-mapping");
    await user.click(applyBtn);

    // Should show validation issue(s), but submit is enabled due to allowSubmitWithErrors = true
    const submitBtn = await screen.findByTestId("submit-button");
    expect(screen.getByText(/validation issue\(s\)/i)).toBeInTheDocument();
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("filters to show invalid rows only", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CsvUploadMapper
        expectedColumns={defaultAssetColumns()}
        onSubmit={onSubmit}
        initialCsvText={csvSample}
      />
    );

    const applyBtn = await screen.findByTestId("apply-mapping");
    await user.click(applyBtn);

    // Toggle "Show invalid rows only"
    const checkbox = screen.getByRole("checkbox", { name: /show invalid rows only/i });
    await user.click(checkbox);

    // Only two rows should be visible (row #2 and #3). Check presence by row indices or errors column
    // Verify first row index no longer visible
    expect(screen.queryByTestId("cell-0-assetId")).not.toBeInTheDocument();
    // The invalid rows inputs should be present
    expect(screen.getByTestId("cell-1-assetId")).toBeInTheDocument();
    expect(screen.getByTestId("cell-2-assetId")).toBeInTheDocument();
  });
});
