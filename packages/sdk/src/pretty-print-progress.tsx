import { render, Box, Text, Static, Instance, Newline } from "ink";
import Spinner from "ink-spinner";
import figures from "figures";

export interface Task {
  name: string;
  details: string;
  current?: number;
  total?: number;
  unit?: string;
}

const Percentage = ({ percentage }: { percentage: string }) => {
  return <Text dimColor>{percentage}%</Text>;
};

const CurrentTask = ({
  task,
  percentage,
  duration,
  paddingTop = 0,
}: {
  task: Task;
  percentage: string;
  duration: number;
  paddingTop?: number;
}) => {
  return (
    <Box key={task.name} paddingTop={paddingTop} flexDirection="column">
      <Text color={percentage === "100.00" ? "green" : "white"}>
        {percentage === "100.00" ? figures.tick : <Spinner type="dots" />}{" "}
        {task.name} <Text dimColor>{task.details}</Text>
      </Text>

      <Box paddingTop={0} paddingLeft={2}>
        <Text dimColor>
          {percentage !== "100.00" ? (
            <>
              <Text>
                {task.current} / {task.total} {task.unit}
              </Text>
              , <Percentage percentage={percentage} />, took: {duration}ms
            </>
          ) : (
            <>
              <Text>
                {task.current} {task.unit}
              </Text>
              , took: {duration}ms
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
};

export async function prettyPrintProgress(
  taskName: string,
  options: {
    details?: string;
    unit: string;
    paddingTop?: number;
  },
  callback: (
    onProgress: (current: number, total: number) => void
  ) => Promise<void>
) {
  const startTime = Date.now();

  let percentage: string;
  const onProgress = (current: number, total: number) => {
    if (percentage === "100.00") return;
    percentage = (((current + 1) / total) * 100).toFixed(2);
    const duration = Date.now() - startTime;
    const instance = render(
      <>
        <CurrentTask
          task={{
            name: taskName,
            details: options.details,
            current: current + 1,
            total,
            unit: options.unit,
          }}
          percentage={percentage}
          duration={duration}
          paddingTop={options.paddingTop}
        />
      </>
    );
    if (percentage === "100.00") {
      instance.unmount();
    }
  };

  await callback(onProgress);
}
