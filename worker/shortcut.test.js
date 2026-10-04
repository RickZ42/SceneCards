import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(new URL("../docs/iphone-shortcut.template.json", import.meta.url), "utf8"));
const actions = workflow.WFWorkflowActions;

test("shortcut template has no personal key and only authenticates Worker requests", () => {
  const requests = actions.filter((action) => action.WFWorkflowActionIdentifier.endsWith(".downloadurl"));
  assert.equal(requests.length, 4);
  const external = requests.filter((action) => typeof action.WFWorkflowActionParameters.WFURL !== "string");
  assert.equal(external.length, 1);
  assert.equal(external[0].WFWorkflowActionParameters.WFHTTPMethod, "GET");
  assert.equal(external[0].WFWorkflowActionParameters.WFHTTPHeaders, undefined);
  for (const request of requests.filter((action) => !external.includes(action))) {
    const params = request.WFWorkflowActionParameters;
    assert.match(params.WFURL, /^WORKER_URL\/(definition|lookup|capture)$/);
    assert.equal(params.WFHTTPHeaders.Value.WFDictionaryFieldValueItems[0].WFValue.Value.string, "Bearer INBOX_KEY");
  }
});

test("shortcut checks textual results and only saves inside the Add menu branch", () => {
  const groups = [];
  let menuGroup;
  let menuBranch;
  let previewIndex = -1;
  let captureIndex = -1;
  for (const [index, action] of actions.entries()) {
    const params = action.WFWorkflowActionParameters;
    if (action.WFWorkflowActionIdentifier.endsWith(".conditional")) {
      if (params.WFControlFlowMode === 0) {
        groups.push(params.GroupingIdentifier);
        assert.equal(params.WFCondition, 100);
        assert.equal(params.WFInput.Type, "Variable");
        assert.equal(params.WFInput.Variable.Value.Aggrandizements[0].CoercionItemClass, "WFStringContentItem");
      } else if (params.WFControlFlowMode === 1) {
        assert.equal(params.GroupingIdentifier, groups.at(-1));
      } else {
        assert.equal(params.GroupingIdentifier, groups.pop());
      }
    }
    if (action.WFWorkflowActionIdentifier.endsWith(".choosefrommenu")) {
      if (params.WFControlFlowMode === 0) {
        previewIndex = index;
        menuGroup = params.GroupingIdentifier;
        assert.deepEqual(params.WFMenuItems, ["Add"]); // Shortcuts supplies Cancel.
        assert.ok(params.WFMenuPrompt);
      } else if (params.WFControlFlowMode === 1) {
        assert.equal(params.GroupingIdentifier, menuGroup);
        menuBranch = params.WFMenuItemTitle;
      } else {
        assert.equal(params.GroupingIdentifier, menuGroup);
        menuGroup = undefined;
        menuBranch = undefined;
      }
    }
    if (params.WFURL === "WORKER_URL/capture") {
      assert.equal(menuBranch, "Add");
      captureIndex = index;
      assert.equal(groups.length, 2, "save must be inside definition and bilingual-preview success branches");
    }
  }
  assert.equal(groups.length, 0);
  assert.ok(previewIndex >= 0 && captureIndex > previewIndex);
  assert.equal(menuGroup, undefined);
  assert.equal(actions.length, 23);
  assert.deepEqual(workflow.WFWorkflowInputContentItemClasses, ["WFStringContentItem"]);
});
