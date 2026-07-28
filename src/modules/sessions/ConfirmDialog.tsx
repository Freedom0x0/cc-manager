import React from 'react';
import { Modal, Input, message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  requireInput?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message: msg,
  confirmText = '确认',
  requireInput,
  onConfirm,
  onCancel,
}) => {
  const [input, setInput] = React.useState('');
  React.useEffect(() => {
    if (open) setInput('');
  }, [open]);

  return (
    <Modal
      title={
        <span>
          <ExclamationCircleOutlined style={{ color: '#f59e0b', marginRight: 8 }} />
          {title}
        </span>
      }
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={confirmText}
      cancelText="取消"
      okButtonProps={{
        danger: !!requireInput,
        disabled: !!requireInput && input !== requireInput,
      }}
    >
      <p>{msg}</p>
      {requireInput && (
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`请输入: ${requireInput}`}
        />
      )}
    </Modal>
  );
};
