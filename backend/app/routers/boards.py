from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/boards", tags=["boards"])


def ensure_default_board(db: Session, user: models.User) -> models.JobBoard:
    """Every account needs at least one board. Also backfills any job that
    predates this feature (board_id is NULL) onto it, so upgrading never
    loses or hides existing applications."""
    board = (
        db.query(models.JobBoard)
        .filter(models.JobBoard.user_id == user.id, models.JobBoard.is_default == True)  # noqa: E712
        .first()
    )
    if not board:
        board = db.query(models.JobBoard).filter(models.JobBoard.user_id == user.id).order_by(models.JobBoard.position).first()
    if not board:
        board = models.JobBoard(user_id=user.id, name="My Job Search", is_default=True, position=0)
        db.add(board)
        db.commit()
        db.refresh(board)

    orphaned = (
        db.query(models.JobApplication)
        .filter(models.JobApplication.user_id == user.id, models.JobApplication.board_id.is_(None))
        .count()
    )
    if orphaned:
        db.query(models.JobApplication).filter(
            models.JobApplication.user_id == user.id, models.JobApplication.board_id.is_(None)
        ).update({"board_id": board.id})
        db.commit()
    return board


def _job_counts_by_board(db: Session, user_id: int) -> dict:
    rows = (
        db.query(models.JobApplication.board_id, func.count(models.JobApplication.id))
        .filter(models.JobApplication.user_id == user_id)
        .group_by(models.JobApplication.board_id)
        .all()
    )
    return dict(rows)


@router.get("", response_model=list[schemas.JobBoardOut])
def list_boards(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    ensure_default_board(db, current_user)
    boards = (
        db.query(models.JobBoard)
        .filter(models.JobBoard.user_id == current_user.id)
        .order_by(models.JobBoard.position, models.JobBoard.id)
        .all()
    )
    counts = _job_counts_by_board(db, current_user.id)
    result = []
    for b in boards:
        out = schemas.JobBoardOut.model_validate(b)
        out.job_count = counts.get(b.id, 0)
        result.append(out)
    return result


@router.post("", response_model=schemas.JobBoardOut)
def create_board(payload: schemas.JobBoardCreate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    ensure_default_board(db, current_user)
    max_pos = db.query(func.max(models.JobBoard.position)).filter(models.JobBoard.user_id == current_user.id).scalar() or 0
    name = payload.name.strip()[:150] or "Untitled Board"
    board = models.JobBoard(user_id=current_user.id, name=name, position=max_pos + 1)
    db.add(board)
    db.commit()
    db.refresh(board)
    out = schemas.JobBoardOut.model_validate(board)
    out.job_count = 0
    return out


@router.patch("/{board_id}", response_model=schemas.JobBoardOut)
def update_board(board_id: int, payload: schemas.JobBoardUpdate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    board = db.query(models.JobBoard).filter(models.JobBoard.id == board_id, models.JobBoard.user_id == current_user.id).first()
    if not board:
        raise HTTPException(404, "Board not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()[:150] or board.name
    for field, value in data.items():
        setattr(board, field, value)
    db.commit()
    db.refresh(board)
    counts = _job_counts_by_board(db, current_user.id)
    out = schemas.JobBoardOut.model_validate(board)
    out.job_count = counts.get(board.id, 0)
    return out


@router.delete("/{board_id}")
def delete_board(board_id: int, reassign_to: Optional[int] = None, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    board = db.query(models.JobBoard).filter(models.JobBoard.id == board_id, models.JobBoard.user_id == current_user.id).first()
    if not board:
        raise HTTPException(404, "Board not found")
    other_boards = db.query(models.JobBoard).filter(
        models.JobBoard.user_id == current_user.id, models.JobBoard.id != board_id
    ).all()
    if not other_boards:
        raise HTTPException(400, "Can't delete your only board — create another board first.")

    target = next((b for b in other_boards if b.id == reassign_to), None) if reassign_to else None
    if not target:
        target = next((b for b in other_boards if b.is_default), other_boards[0])

    db.query(models.JobApplication).filter(
        models.JobApplication.board_id == board_id, models.JobApplication.user_id == current_user.id,
    ).update({"board_id": target.id})
    was_default = board.is_default
    db.delete(board)
    if was_default:
        target.is_default = True
    db.commit()
    return {"ok": True, "reassigned_to": target.id, "reassigned_to_name": target.name}
