/********************************************************************************
 * Copyright (c) 2019 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { inject, injectable, optional } from "inversify";
import {
    Action,
    Bounds,
    BoundsAware,
    Dimension,
    EdgeRouterRegistry,
    ElementAndBounds,
    findParentByFeature,
    ISnapper,
    isSelected,
    isViewport,
    MouseListener,
    Point,
    SConnectableElement,
    SetBoundsAction,
    SModelElement,
    SModelRoot,
    SParentElement,
    TYPES
} from "sprotty";

import {
    ChangeBoundsOperation,
    ChangeRoutingPointsOperation,
    CompoundOperation,
    ElementAndRoutingPoints,
    Operation
} from "../../base/operations/operation";
import { GLSP_TYPES } from "../../base/types";
import { isValidMove, isValidSize, WriteablePoint } from "../../utils/layout-utils";
import {
    forEachElement,
    isNonRoutableSelectedMovableBoundsAware,
    toElementAndBounds,
    toElementAndRoutingPoints
} from "../../utils/smodel-util";
import { isBoundsAwareMoveable, isResizable, Resizable, ResizeHandleLocation, SResizeHandle } from "../change-bounds/model";
import {
    createMovementRestrictionFeedback,
    IMovementRestrictor,
    removeMovementRestrictionFeedback
} from "../change-bounds/movement-restrictor";
import { SelectionListener, SelectionService } from "../select/selection-service";
import {
    FeedbackMoveMouseListener,
    HideChangeBoundsToolResizeFeedbackAction,
    ShowChangeBoundsToolResizeFeedbackAction
} from "../tool-feedback/change-bounds-tool-feedback";
import { applyCssClasses, CursorCSS, cursorFeedbackAction, deleteCssClasses } from "../tool-feedback/css-feedback";
import { BaseGLSPTool } from "./base-glsp-tool";
import { DragAwareMouseListener } from "./drag-aware-mouse-listener";


/**
 * The change bounds tool has the license to move multiple elements or resize a single element by implementing the ChangeBounds operation.
 * In contrast to Sprotty's implementation this tool only sends a `ChangeBoundsOperationAction` when an operation has finished and does not
 * provide client-side live updates to improve performance.
 *
 * | Operation | Client Update    | Server Update
 * +-----------+------------------+----------------------------
 * | Move      | MoveAction       | ChangeBoundsOperationAction
 * | Resize    | SetBoundsAction  | ChangeBoundsOperationAction
 *
 * To provide a visual client updates during move we install the `FeedbackMoveMouseListener` and to provide visual client updates during resize
 * and send the server updates we install the `ChangeBoundsListener`.
 */
@injectable()
export class ChangeBoundsTool extends BaseGLSPTool {
    static ID = "glsp.change-bounds-tool";
    readonly id = ChangeBoundsTool.ID;

    @inject(GLSP_TYPES.SelectionService) protected selectionService: SelectionService;
    @inject(EdgeRouterRegistry) @optional() readonly edgeRouterRegistry?: EdgeRouterRegistry;
    @inject(TYPES.ISnapper) @optional() readonly snapper?: ISnapper;
    @inject(GLSP_TYPES.IMovementRestrictor) @optional() readonly movementRestrictor?: IMovementRestrictor;
    protected feedbackMoveMouseListener: MouseListener;
    protected changeBoundsListener: MouseListener & SelectionListener;

    enable() {
        // install feedback move mouse listener for client-side move updates
        this.feedbackMoveMouseListener = this.createMoveMouseListener();
        this.mouseTool.register(this.feedbackMoveMouseListener);

        // install change bounds listener for client-side resize updates and server-side updates
        this.changeBoundsListener = this.createChangeBoundsListener();
        this.mouseTool.register(this.changeBoundsListener);
        this.selectionService.register(this.changeBoundsListener);

        // register feedback
        this.feedbackDispatcher.registerFeedback(this, [new ShowChangeBoundsToolResizeFeedbackAction]);
    }

    protected createMoveMouseListener(): MouseListener {
        return new FeedbackMoveMouseListener(this);
    }

    protected createChangeBoundsListener(): MouseListener & SelectionListener {
        return new ChangeBoundsListener(this);
    }

    disable() {
        this.mouseTool.deregister(this.changeBoundsListener);
        this.selectionService.deregister(this.changeBoundsListener);
        this.mouseTool.deregister(this.feedbackMoveMouseListener);
        this.feedbackDispatcher.deregisterFeedback(this.feedbackMoveMouseListener, []);
        this.feedbackDispatcher.deregisterFeedback(this.changeBoundsListener, [new HideChangeBoundsToolResizeFeedbackAction]);
    }
}

export class ChangeBoundsListener extends DragAwareMouseListener implements SelectionListener {
    static readonly CSS_CLASS_ACTIVE = 'active';

    // members for calculating the correct position change
    protected initialBounds: Bounds | undefined;
    protected lastDragPosition?: Point;
    protected positionDelta: WriteablePoint = { x: 0, y: 0 };

    // members for resize mode
    protected activeResizeElementId?: string;
    protected activeResizeHandle?: SResizeHandle;

    constructor(protected tool: ChangeBoundsTool) {
        super();
    }

    mouseDown(target: SModelElement, event: MouseEvent): Action[] {
        super.mouseDown(target, event);
        if (event.button !== 0) {
            return [];
        }
        // check if we have a resize handle (only single-selection)
        if (this.activeResizeElementId && target instanceof SResizeHandle) {
            this.activeResizeHandle = target;
        } else {
            this.setActiveResizeElement(target);
        }
        if (this.activeResizeElementId) {
            this.initPosition(event);
        } else {
            this.reset();
        }
        return [];
    }

    mouseMove(target: SModelElement, event: MouseEvent): Action[] {
        super.mouseMove(target, event);
        if (this.isMouseDrag && this.activeResizeHandle) {
            // rely on the FeedbackMoveMouseListener to update the element bounds of selected elements
            // consider resize handles ourselves
            const actions: Action[] = [cursorFeedbackAction(CursorCSS.RESIZE), applyCssClasses(this.activeResizeHandle, ChangeBoundsListener.CSS_CLASS_ACTIVE)];
            const positionUpdate = this.updatePosition(target, event);
            if (positionUpdate) {
                const resizeActions = this.handleResizeOnClient(positionUpdate);
                actions.push(...resizeActions);
            }
            return actions;
        }
        return [];
    }

    draggingMouseUp(target: SModelElement, event: MouseEvent): Action[] {
        if (this.lastDragPosition === undefined) {
            this.resetPosition();
            return [];
        }
        const actions: Action[] = [];

        if (this.activeResizeHandle) {
            // Resize
            actions.push(...this.handleResize(this.activeResizeHandle));
        } else {
            // Move
            actions.push(...this.handleMoveOnServer(target));
        }
        this.resetPosition();
        return actions;
    }

    protected handleMoveOnServer(target: SModelElement): Action[] {
        const operations: Operation[] = [];

        operations.push(...this.handleMoveElementsOnServer(target));
        operations.push(...this.handleMoveRoutingPointsOnServer(target));
        return [new CompoundOperation(operations)];
    }

    protected handleMoveElementsOnServer(target: SModelElement): Operation[] {
        const result: Operation[] = [];
        const newBounds: ElementAndBounds[] = [];
        forEachElement(target, isNonRoutableSelectedMovableBoundsAware, element => {
            this.createElementAndBounds(element).forEach(bounds => newBounds.push(bounds));
        });
        if (newBounds.length > 0) {
            result.push(new ChangeBoundsOperation(newBounds));
        }
        return result;
    }

    protected handleMoveRoutingPointsOnServer(target: SModelElement): Operation[] {
        const result: Operation[] = [];
        const newRoutingPoints: ElementAndRoutingPoints[] = [];
        forEachElement(target, isNonRoutableSelectedMovableBoundsAware, element => {
            //  If client routing is enabled -> delegate routingpoints of connected edges to server
            if (this.tool.edgeRouterRegistry && element instanceof SConnectableElement) {
                element.incomingEdges.map(toElementAndRoutingPoints).forEach(ear => newRoutingPoints.push(ear));
                element.outgoingEdges.map(toElementAndRoutingPoints).forEach(ear => newRoutingPoints.push(ear));
            }
        });
        if (newRoutingPoints.length > 0) {
            result.push(new ChangeRoutingPointsOperation(newRoutingPoints));
        }
        return result;
    }

    protected handleResize(activeResizeHandle: SResizeHandle): Action[] {
        const actions: Action[] = [];
        actions.push(cursorFeedbackAction(CursorCSS.DEFAULT));
        actions.push(deleteCssClasses(activeResizeHandle, ChangeBoundsListener.CSS_CLASS_ACTIVE));
        const resizeElement = findParentByFeature(activeResizeHandle, isResizable);
        if (this.isActiveResizeElement(resizeElement)) {
            this.createChangeBoundsAction(resizeElement).forEach(action => actions.push(action));
        }
        return actions;
    }

    selectionChanged(root: SModelRoot, selectedElements: string[]): void {
        if (this.activeResizeElementId) {
            if (selectedElements.includes(this.activeResizeElementId)) {
                // our active element is still selected, nothing to do
                return;
            }

            // try to find some other selected element and mark that active
            for (const elementId of selectedElements.reverse()) {
                const element = root.index.getById(elementId);
                if (element && this.setActiveResizeElement(element)) {
                    return;
                }
            }
            this.reset();
        }
    }

    protected setActiveResizeElement(target: SModelElement): boolean {
        // check if we have a selected, moveable element (multi-selection allowed)
        const moveableElement = findParentByFeature(target, isBoundsAwareMoveable);
        if (isSelected(moveableElement)) {
            // only allow one element to have the element resize handles
            this.activeResizeElementId = moveableElement.id;
            this.tool.dispatchFeedback(this, [new ShowChangeBoundsToolResizeFeedbackAction(this.activeResizeElementId)]);
            return true;
        }
        return false;
    }

    protected isActiveResizeElement(element?: SModelElement): element is SParentElement & BoundsAware {
        return element !== undefined && element.id === this.activeResizeElementId;
    }

    protected initPosition(event: MouseEvent) {
        this.lastDragPosition = { x: event.pageX, y: event.pageY };
        if (this.activeResizeHandle) {
            const resizeElement = findParentByFeature(this.activeResizeHandle, isResizable);
            this.initialBounds = { x: resizeElement!.bounds.x, y: resizeElement!.bounds.y, width: resizeElement!.bounds.width, height: resizeElement!.bounds.height };
        }
    }

    protected updatePosition(target: SModelElement, event: MouseEvent): Point | undefined {
        if (this.lastDragPosition) {
            const newDragPosition = { x: event.pageX, y: event.pageY };

            const viewport = findParentByFeature(target, isViewport);
            const zoom = viewport ? viewport.zoom : 1;
            const dx = (event.pageX - this.lastDragPosition.x) / zoom;
            const dy = (event.pageY - this.lastDragPosition.y) / zoom;
            const deltaToLastPosition = { x: dx, y: dy };
            this.lastDragPosition = newDragPosition;

            // update position delta with latest delta
            this.positionDelta.x += deltaToLastPosition.x;
            this.positionDelta.y += deltaToLastPosition.y;

            // snap our delta and only send update if the position actually changes
            // otherwise accumulate delta until we do snap to an update
            const positionUpdate = this.snap(this.positionDelta, target, !event.shiftKey);
            if (positionUpdate.x === 0 && positionUpdate.y === 0) {
                return undefined;
            }

            // we update our position so we need to reset our delta
            this.positionDelta.x = 0;
            this.positionDelta.y = 0;
            return positionUpdate;
        }
        return undefined;
    }

    protected reset() {
        this.tool.dispatchFeedback(this, [new HideChangeBoundsToolResizeFeedbackAction()]);
        this.tool.dispatchActions([cursorFeedbackAction(CursorCSS.DEFAULT)]);
        this.resetPosition();
    }

    protected resetPosition() {
        this.activeResizeHandle = undefined;
        this.lastDragPosition = undefined;
        this.positionDelta = { x: 0, y: 0 };
    }

    protected handleResizeOnClient(positionUpdate: Point): Action[] {
        if (!this.activeResizeHandle) {
            return [];
        }

        const resizeElement = findParentByFeature(this.activeResizeHandle, isResizable);
        if (this.isActiveResizeElement(resizeElement)) {
            switch (this.activeResizeHandle.location) {
                case ResizeHandleLocation.TopLeft:
                    return this.handleTopLeftResize(resizeElement, positionUpdate);
                case ResizeHandleLocation.TopRight:
                    return this.handleTopRightResize(resizeElement, positionUpdate);
                case ResizeHandleLocation.BottomLeft:
                    return this.handleBottomLeftResize(resizeElement, positionUpdate);
                case ResizeHandleLocation.BottomRight:
                    return this.handleBottomRightResize(resizeElement, positionUpdate);
            }
        }
        return [];
    }

    protected handleTopLeftResize(resizeElement: SParentElement & Resizable, positionUpdate: Point): Action[] {
        return this.createSetBoundsAction(resizeElement,
            resizeElement.bounds.x + positionUpdate.x,
            resizeElement.bounds.y + positionUpdate.y,
            resizeElement.bounds.width - positionUpdate.x,
            resizeElement.bounds.height - positionUpdate.y);
    }

    protected handleTopRightResize(resizeElement: SParentElement & Resizable, positionUpdate: Point): Action[] {
        return this.createSetBoundsAction(resizeElement,
            resizeElement.bounds.x,
            resizeElement.bounds.y + positionUpdate.y,
            resizeElement.bounds.width + positionUpdate.x,
            resizeElement.bounds.height - positionUpdate.y);
    }

    protected handleBottomLeftResize(resizeElement: SParentElement & Resizable, positionUpdate: Point): Action[] {
        return this.createSetBoundsAction(resizeElement,
            resizeElement.bounds.x + positionUpdate.x,
            resizeElement.bounds.y,
            resizeElement.bounds.width - positionUpdate.x,
            resizeElement.bounds.height + positionUpdate.y);
    }

    protected handleBottomRightResize(resizeElement: SParentElement & Resizable, positionUpdate: Point): Action[] {
        return this.createSetBoundsAction(resizeElement,
            resizeElement.bounds.x,
            resizeElement.bounds.y,
            resizeElement.bounds.width + positionUpdate.x,
            resizeElement.bounds.height + positionUpdate.y);
    }

    protected createChangeBoundsAction(element: SModelElement & BoundsAware): Action[] {
        if (this.isValidBoundChange(element, element.bounds, element.bounds)) {
            return [new ChangeBoundsOperation([toElementAndBounds(element)])];
        } else if (this.initialBounds) {
            const actions: Action[] = [];
            if (this.tool.movementRestrictor) {
                actions.push(removeMovementRestrictionFeedback(element, this.tool.movementRestrictor));
            }
            actions.push(new SetBoundsAction([{ elementId: element.id, newPosition: this.initialBounds, newSize: this.initialBounds }]));
            return actions;
        }
        return [];
    }

    protected createElementAndBounds(element: SModelElement & BoundsAware): ElementAndBounds[] {
        if (this.isValidBoundChange(element, element.bounds, element.bounds)) {
            return [toElementAndBounds(element)];
        }
        return [];
    }

    protected createSetBoundsAction(element: SModelElement & BoundsAware, x: number, y: number, width: number, height: number): Action[] {
        const newPosition = { x, y };
        const newSize = { width, height };
        const result: Action[] = [];

        if (this.isValidBoundChange(element, newPosition, newSize)) {
            if (this.tool.movementRestrictor) {
                result.push(removeMovementRestrictionFeedback(element, this.tool.movementRestrictor));
            }
            result.push(new SetBoundsAction([{ elementId: element.id, newPosition, newSize }]));

        } else if (this.isValidSize(element, newSize)) {
            if (this.tool.movementRestrictor) {
                result.push(createMovementRestrictionFeedback(element, this.tool.movementRestrictor));
            }
            result.push(new SetBoundsAction([{ elementId: element.id, newPosition, newSize }]));
        }

        return result;
    }

    protected snap(position: Point, element: SModelElement, isSnap: boolean): Point {
        return isSnap && this.tool.snapper
            ? this.tool.snapper.snap(position, element)
            : { x: position.x, y: position.y };
    }

    protected isValidBoundChange(element: SModelElement & BoundsAware, newPosition: Point, newSize: Dimension): boolean {
        return this.isValidSize(element, newSize) && this.isValidMove(element, newPosition);
    }

    protected isValidSize(element: SModelElement & BoundsAware, size: Dimension) {
        return isValidSize(element, size);
    }

    protected isValidMove(element: SModelElement & BoundsAware, newPosition: Point) {
        return isValidMove(element, newPosition, this.tool.movementRestrictor);
    }
}
